const headers = "index,trade_id,date,underlying,option_type,strike,expiration,contracts,buy_time,buy_price,cost_usd,sell_time,sell_price,proceeds_usd,gross_pnl_usd,return_pct,status,source,verification_note".split(",");

export const uploadLimit = 512 * 1024;

function splitCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  function field() {
    row.push(value);
    value = "";
    state = "plain";
  }
  function line() {
    field();
    if (row.length > 1 || row[0].trim()) rows.push(row);
    row = [];
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === "quoted") {
      if (char !== '"') value += char;
      else if (text[i + 1] === '"') { value += '"'; i++; }
      else state = "closed";
    } else if (char === ",") field();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      line();
    } else if (char === '"' && !value && state === "plain") state = "quoted";
    else if (char === '"' || state === "closed") throw new Error("Invalid CSV quoting.");
    else value += char;
  }
  if (state === "quoted") throw new Error("The CSV contains an unclosed quote.");
  line();
  return rows;
}

export function cents(value: string): bigint {
  const match = /^(-?)(\d{1,24})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid USD amount.");
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -amount : amount;
}

function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date.");
  const parsed = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Invalid date.");
  return value;
}

function time(value: string) {
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?: \((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?:[1-9]|[12]\d|3[01])\))?$/;
  if (value.length > 500 || !value.split(" / ").every((part) => clock.test(part))) {
    throw new Error("Invalid source time.");
  }
  return value;
}

function premium(value: string) {
  if (!/^\d{1,10}(?:\.\d{1,8})?$/.test(value)) throw new Error("Invalid strike or premium.");
  return value;
}

export function parseSummaryCsv(raw: string) {
  if (raw.includes("\0")) throw new Error("The CSV contains invalid characters.");
  const [header, ...rows] = splitCsv(raw.replace(/^\uFEFF/, ""));
  if (header?.join(",") !== headers.join(",")) throw new Error("Choose the Options Journal paired-trade CSV.");
  if (!rows.length || rows.length > 2000) throw new Error("The CSV must contain 1–2,000 trades.");
  const ids = new Set<string>();
  return rows.map((row, index) => {
    try {
      if (row.length !== headers.length) throw new Error("Wrong number of columns.");
      const [, id, day, symbol, optionType, strike, expiration, quantity, buyTime, buyPrice,
        cost, sellTime, sellPrice, proceeds, gross, , , source, note] = row;
      if (!/^\d{1,16}$/.test(id) || ids.has(id)) throw new Error("Missing or duplicate trade ID.");
      if (!/^[A-Z][A-Z0-9.\-]{0,14}$/.test(symbol)) throw new Error("Invalid symbol.");
      if (optionType !== "Call" && optionType !== "Put") throw new Error("Invalid option type.");
      if (!/^\d{1,6}$/.test(quantity) || Number(quantity) < 1) throw new Error("Invalid contract quantity.");
      if (!["original_csv", "activity_screenshots"].includes(source)) throw new Error("Unknown trade provenance.");
      if (cents(cost) < 0n || cents(proceeds) < 0n || cents(proceeds) - cents(cost) !== cents(gross)) {
        throw new Error("Proceeds minus cost does not match the stated gross P&L.");
      }
      ids.add(id);
      return {
        id, day: date(day), symbol, option_type: optionType, strike: premium(strike),
        expiration: date(expiration), quantity: Number(quantity), buy_time: time(buyTime),
        buy_price: premium(buyPrice), cost, sell_time: time(sellTime), sell_price: premium(sellPrice),
        proceeds, gross, source, note,
      };
    } catch (error) {
      throw new Error(`Data row ${index + 1}: ${error instanceof Error ? error.message : "Invalid trade."}`);
    }
  });
}

export function signedUsd(amount: bigint) {
  const magnitude = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : amount > 0n ? "+" : ""}$${(magnitude / 100n).toLocaleString("en-US")}.${(magnitude % 100n).toString().padStart(2, "0")}`;
}

export function formatThbEstimate(amountCents: bigint, rate = 34): string {
  const usd = Number(amountCents) / 100;
  const thb = usd * rate;
  const sign = thb < 0 ? "−" : "";
  const absThb = Math.abs(thb);
  const formatted = absThb.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `≈ ${sign}฿${formatted}`;
}
