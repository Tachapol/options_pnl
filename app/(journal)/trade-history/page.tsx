import { notFound } from "next/navigation";
import { z } from "zod";
import { DimeHistory } from "@/components/dime-history";
import { TradeHistoryList, grossTradeAmount } from "@/components/trade-history-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDimeAccount } from "@/lib/dime-account";
import { tradeSummaryColumns } from "@/lib/monthly-trades";
import { requireSession } from "@/lib/session";
import { summaryExecutions } from "@/lib/trade-executions";

export default async function TradeHistory({ searchParams }: {
  searchParams: Promise<{ account?: string | string[] }>;
}) {
  const { client } = await requireSession();
  const params = await searchParams;
  const accountId = z.uuid().optional().safeParse(params.account);
  if (!accountId.success) notFound();

  const { data: account, error } = await getDimeAccount(client, accountId.data);
  if (!account) {
    return <>
      <header className="page-header"><h1>Trade History</h1></header>
      <p className="notice" role="alert">{error ? "Could not load the Dime account." : "Dime USD account unavailable."}</p>
    </>;
  }

  const { data: rows, error: rowsError } = await client.from("trade_summaries").select(tradeSummaryColumns)
    .eq("account_id", account.id).order("day", { ascending: false })
    .order("import_id").order("source_trade_id").limit(50);

  return <>
    <header className="page-header">
      <h1>Trade History</h1>
    </header>
    <div className="grid grid-cols-1 gap-4">
      <DimeHistory account={account.id} timeZone={account.timezone} />
      <Card aria-labelledby="csv-trades">
        <CardHeader className="px-3 sm:px-5"><CardTitle id="csv-trades">CSV trade summaries</CardTitle></CardHeader>
        <CardContent className="px-3 sm:px-5">
          {rowsError ? <p role="alert">Trade summaries could not be loaded.</p> : rows?.length ? (
            <TradeHistoryList transactions={rows.map((row) => ({
              id: `${row.import_id}/${row.source_trade_id}`,
              day: row.day,
              symbol: row.symbol,
              contract: `${row.option_type} ${row.strike}`,
              expiration: row.expiration,
              quantity: row.quantity,
              executions: summaryExecutions({ ...row, sessionDate: row.day }, row, account.timezone),
              gross: grossTradeAmount(row.gross),
            }))} />
          ) : <p className="text-sm text-muted-foreground">No CSV trades yet.</p>}
        </CardContent>
      </Card>
    </div>
  </>;
}
