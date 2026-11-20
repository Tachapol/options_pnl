import Link from "next/link";
import { TradeHistoryList, grossTradeAmount, type HistoryTransaction } from "@/components/trade-history-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/session";
import { executionAt, type TradeExecution } from "@/lib/trade-executions";

type HistoryFill = {
  record_id: string; image_id: string; day: string; clock: string; symbol: string;
  strike: string; option_type: string; expiration: string; side: TradeExecution["side"]; quantity: number; price: string;
  matched: number | string | null; gross: string | null; open_quantity: number | string | null;
};

function fillStatus(fill: HistoryFill) {
  if (fill.side === "Buy") {
    if (fill.open_quantity === null) return "Waiting for FIFO match";
    return Number(fill.open_quantity) > 0 ? `Open (${fill.open_quantity} left)` : "Closed";
  }

  const matched = Number(fill.matched ?? 0);
  if (matched === 0) return "Awaiting match";
  return matched === fill.quantity ? "Matched" : `${matched} of ${fill.quantity} matched`;
}

function toTransaction(fill: HistoryFill, timeZone: string): HistoryTransaction {
  const gross = fill.gross;
  return {
    id: fill.record_id,
    day: fill.day,
    symbol: fill.symbol,
    contract: `${fill.option_type} ${fill.strike}`,
    expiration: fill.expiration,
    executions: [executionAt(fill.side, fill.day, fill.clock, timeZone, fill.quantity, fill.price)],
    gross: gross != null ? grossTradeAmount(gross) : undefined,
    status: fillStatus(fill),
    evidence: <Link href={`/imports/dime/${fill.image_id}`} prefetch={false}
      className="inline-flex min-h-11 items-center text-link underline">View screenshot ↗</Link>,
  };
}

export async function DimeHistory({ account, timeZone }: { account: string; timeZone: string }) {
  const { client } = await requireSession();
  const { data, error } = await client.rpc("dime_history", { target_account: account });
  const fills: HistoryFill[] = Array.isArray(data) ? data : [];

  return <Card aria-labelledby="dime-transactions">
    <CardHeader className="px-3 sm:px-5">
      <CardTitle id="dime-transactions">Dime Screenshot Fills</CardTitle>
    </CardHeader>
    <CardContent className="px-3 sm:px-5">
      {error ? <p role="alert">Dime transactions could not be loaded.</p> :
        fills.length ? <TradeHistoryList transactions={fills.map((fill) => toTransaction(fill, timeZone))} /> :
        <p className="text-sm text-muted-foreground">No screenshot fills yet. Once imported, buys and sells appear here, including fills waiting for a match.</p>}
    </CardContent>
  </Card>;
}
