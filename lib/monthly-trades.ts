import type { SupabaseClient } from "@supabase/supabase-js";
import { shiftJournalMonth } from "./journal-month";
import { executionAt, summaryExecutions, type SummaryEvidence, type TradeExecution } from "./trade-executions";

const tradeSummaryEvidenceColumns = "import_id,source_trade_id,note,cost:cost::text,proceeds:proceeds::text";
export const tradeSummaryColumns = `${tradeSummaryEvidenceColumns},day,symbol,option_type,strike,expiration,quantity,buy_time,sell_time,buy_price:buy_price::text,sell_price:sell_price::text,gross:gross::text`;

type MonthlyTrade = {
  id: string;
  day: string;
  symbol: string;
  option_type: string;
  strike: string;
  expiration: string;
  quantity: number;
  buy_time: string | null;
  sell_time: string;
  buy_price: string | null;
  sell_price: string;
  gross: string;
  source: "original_csv" | "activity_screenshots" | "dime";
  image_id: string | null;
};

export type MonthlyTrades = (Omit<MonthlyTrade, "day"> & { sessionDate: string; executions: TradeExecution[] })[];

const pageSize = 500;

async function readPages<T>(readPage: (start: number, end: number) => PromiseLike<{ data: unknown; error: unknown }>) {
  const rows: T[] = [];
  while (true) {
    const page = await readPage(rows.length, rows.length + pageSize - 1);
    if (page.error || !Array.isArray(page.data)) return null;
    rows.push(...page.data);
    if (page.data.length < pageSize) return rows;
  }
}

export async function getMonthlyTrades(client: SupabaseClient, account: string, month: string, timeZone: string) {
  const start = `${month}-01`;
  const end = `${shiftJournalMonth(month, 1)}-01`;
  const query = client.rpc("journal_closed_trades", {
    target_account: account, start_day: start, end_day: end,
  }).select("id,day,symbol,option_type,strike,expiration,quantity,buy_time,sell_time,buy_price,sell_price,gross:gross::text,source,image_id")
    .order("day").order("sell_time").order("id");

  const evidenceQuery = client.from("trade_summaries")
    .select(tradeSummaryEvidenceColumns)
    .eq("account_id", account).gte("day", start).lt("day", end)
    .order("import_id").order("source_trade_id");
  const fillQuery = client.from("dime_fills").select("record_id,quantity")
    .eq("account_id", account).eq("side", "Sell").gte("day", start).lt("day", end).order("record_id");

  type EvidenceRow = SummaryEvidence & { import_id: string; source_trade_id: string };
  type FillRow = { record_id: string; quantity: number };
  const [trades, evidence, fills] = await Promise.all([
    readPages<MonthlyTrade>((from, to) => query.range(from, to)),
    readPages<EvidenceRow>((from, to) => evidenceQuery.range(from, to)),
    readPages<FillRow>((from, to) => fillQuery.range(from, to)),
  ]);
  if (!trades) return null;

  const notes = new Map(evidence?.map((row) => [`${row.import_id}/${row.source_trade_id}`, row]));
  const sellQuantities = new Map(fills?.map((row) => [row.record_id, row.quantity]));
  return trades.map(({ day: sessionDate, ...trade }) => {
    const executions = trade.source === "dime"
      ? [executionAt("Sell", sessionDate, trade.sell_time, timeZone, sellQuantities.get(trade.id) ?? null, trade.sell_price)]
      : summaryExecutions({ ...trade, sessionDate }, notes.get(trade.id), timeZone);
    return { ...trade, sessionDate, executions };
  });
}
