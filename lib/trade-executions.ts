export type TradeExecution = {
  side: "Buy" | "Sell";
  executedAt: string | null;
  localDate: string;
  localTime: string;
  quantity: number | null;
  price: string | null;
};

type SourceClock = { clock: string; seconds: number; date: string | null };
export type ExecutionSummary = {
  sessionDate: string;
  quantity: number;
  buy_time: string | null;
  sell_time: string;
  buy_price: string | null;
  sell_price: string;
};
export type SummaryEvidence = { note: string; cost: string; proceeds: string };

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const datePattern = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{1,2}";
const clockPattern = new RegExp(
  "^(?:(" + datePattern + ")\\s+)?((?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9])?)(?:\\s+\\((" + datePattern + ")\\))?$",
);
const premiumPattern = "[0-9]{1,10}(?:\\.[0-9]{1,8})?";
const formatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", day: "numeric", timeZone: "UTC" });

function shiftDate(date: string, days: number) {
  const day = new Date(date + "T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

function explicitDate(label: string, sessionDate: string) {
  const [month, day] = label.split(" ");
  const year = Number(sessionDate.slice(0, 4));
  const reference = Date.parse(sessionDate);
  const suffix = "-" + String(months.indexOf(month) + 1).padStart(2, "0") + "-" + day.padStart(2, "0");
  return [year, year - 1, year + 1].map((candidate) => candidate + suffix)
    .filter((candidate) => Number.isFinite(Date.parse(candidate)) && new Date(candidate).toISOString().slice(0, 10) === candidate)
    .sort((a, b) => Math.abs(Date.parse(a) - reference) - Math.abs(Date.parse(b) - reference))[0] ?? null;
}

function parseClocks(value: string | null, sessionDate: string): SourceClock[] {
  if (!value) return [];
  const clocks: SourceClock[] = [];
  for (const part of value.split(/\s*\/\s*/)) {
    const match = clockPattern.exec(part.trim());
    if (!match || (match[1] && match[3])) return [];
    const label = match[1] ?? match[3];
    const date = label ? explicitDate(label, sessionDate) : null;
    if (label && !date) return [];
    const [hours, minutes, seconds = 0] = match[2].split(":").map(Number);
    clocks.push({ clock: match[2], seconds: hours * 3600 + minutes * 60 + seconds, date });
  }
  return clocks;
}

function dateClocks(clocks: SourceClock[], firstDate: string) {
  if (!clocks.length) return [];
  const anchor = clocks.findIndex((clock) => clock.date !== null);
  const dates = Array<string>(clocks.length);
  if (anchor < 0) dates[0] = firstDate;
  else dates[anchor] = clocks[anchor].date!;
  for (let i = Math.max(1, anchor + 1); i < clocks.length; i++) {
    dates[i] = clocks[i].date ?? shiftDate(dates[i - 1], clocks[i].seconds < clocks[i - 1].seconds ? 1 : 0);
  }
  for (let i = anchor - 1; i >= 0; i--) {
    dates[i] = shiftDate(dates[i + 1], clocks[i].seconds > clocks[i + 1].seconds ? -1 : 0);
  }
  return dates;
}

function resolveExecutionTime(date: string, clock: string, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const wallTime = Date.parse(date + "T" + clock + (clock.length === 5 ? ":00" : "") + "Z");
  function wallClockAt(instant: number) {
    const parts = Object.fromEntries(formatter!.formatToParts(instant).map(({ type, value }) => [type, value]));
    return Date.parse(parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute + ":" + parts.second + "Z");
  }

  // Check offsets on both sides of the timestamp to distinguish DST folds from gaps.
  const lookaround = 36 * 60 * 60 * 1000;
  const candidates = new Set([wallTime - lookaround, wallTime, wallTime + lookaround]
    .map((instant) => wallTime - (wallClockAt(instant) - instant))
    .filter((instant) => wallClockAt(instant) === wallTime));
  return candidates.size === 1 ? new Date([...candidates][0]).toISOString() : null;
}

export function executionAt(
  side: TradeExecution["side"], localDate: string, localTime: string, timeZone: string,
  quantity: number | null, price: string | null,
): TradeExecution {
  return { side, localDate, localTime, executedAt: resolveExecutionTime(localDate, localTime, timeZone), quantity, price };
}

function premiumUnits(value: string, scale: number) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(scale, "0"));
}

function splitEvidence(side: TradeExecution["side"], count: number, quantity: number, note: string, total: string) {
  const part = "[0-9]{1,6} at \\$?" + premiumPattern;
  const clause = new RegExp("^" + side + "\\s+(" + part + "(?:\\s+and\\s+" + part + ")*)$", "i");
  const match = note.split(";").map((text) => clause.exec(text.trim())).find(Boolean);
  if (!match || !/^[0-9]+(?:\.[0-9]{1,2})?$/.test(total)) return [];
  const fills = match[1].split(/\s+and\s+/i).map((fill) => {
    const [size, price] = fill.split(/\s+at\s+/i);
    return { quantity: Number(size), price: price.replace(/^\$/, "") };
  });
  if (fills.length !== count || fills.some((fill) => fill.quantity < 1) ||
    fills.reduce((sum, fill) => sum + fill.quantity, 0) !== quantity) return [];

  // Options multipliers are 100. Compare decimal totals exactly before exposing individual prices.
  const notional = fills.reduce((sum, fill) => sum + BigInt(fill.quantity) * premiumUnits(fill.price, 8) * 100n, 0n);
  return notional === premiumUnits(total, 8) ? fills : [];
}

export function summaryExecutions(summary: ExecutionSummary, evidence: SummaryEvidence | undefined, timeZone: string) {
  const buys = parseClocks(summary.buy_time, summary.sessionDate);
  const sells = parseClocks(summary.sell_time, summary.sessionDate);
  const buyDates = dateClocks(buys, summary.sessionDate);
  const firstBuyDate = buys.length ? buyDates[0] : summary.sessionDate;
  const sellStart = buys.length && sells.length && sells[0].seconds < buys[0].seconds ? shiftDate(firstBuyDate, 1) : firstBuyDate;
  const sellDates = dateClocks(sells, sellStart);

  function executions(side: TradeExecution["side"], clocks: SourceClock[], dates: string[], average: string | null) {
    const fills = clocks.length === 1 ? [{ quantity: summary.quantity, price: average }] : evidence
      ? splitEvidence(side, clocks.length, summary.quantity, evidence.note, side === "Buy" ? evidence.cost : evidence.proceeds)
      : [];
    return clocks.map((clock, index) => executionAt(
      side, dates[index], clock.clock, timeZone, fills[index]?.quantity ?? null, fills[index]?.price ?? null,
    ));
  }

  return [...executions("Buy", buys, buyDates, summary.buy_price), ...executions("Sell", sells, sellDates, summary.sell_price)]
    .sort((a, b) => a.localDate.localeCompare(b.localDate) || a.localTime.localeCompare(b.localTime));
}

export function formatExecutionTime(execution: TradeExecution) {
  return dateFormatter.format(new Date(execution.localDate + "T00:00:00Z")) + " · " + execution.localTime;
}

export function holdingDuration(executions: TradeExecution[]) {
  if (executions.some((execution) => execution.executedAt === null)) return null;
  const buys = executions.filter((execution) => execution.side === "Buy").map((execution) => Date.parse(execution.executedAt!));
  const sells = executions.filter((execution) => execution.side === "Sell").map((execution) => Date.parse(execution.executedAt!));
  if (!buys.length || !sells.length) return null;
  const elapsed = (Math.max(...sells) - Math.min(...buys)) / 1000;
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor(elapsed % 3600 / 60);
  const seconds = elapsed % 60;
  return [
    hours ? hours + "h" : "",
    minutes ? minutes + "m" : "",
    seconds || elapsed === 0 ? seconds + "s" : "",
  ].filter(Boolean).join(" ");
}

export function executionTotal(execution: TradeExecution) {
  if (execution.quantity === null || execution.price === null) return null;
  const cents = BigInt(execution.quantity) * premiumUnits(execution.price, 8) * 10000n;
  return (cents + 50000000n) / 100000000n;
}
