import Link from "next/link";
import { MonthlyReview } from "@/components/monthly-review";
import { DimeImportModal } from "@/components/dime-import-modal";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDimeAccount } from "@/lib/dime-account";
import { isJournalMonth } from "@/lib/journal-month";
import { getMonthlyTrades } from "@/lib/monthly-trades";
import { requireSession } from "@/lib/session";
import { cents, signedUsd, formatThbEstimate } from "@/lib/summary-csv";

export default async function Overview({ searchParams }: {
  searchParams: Promise<{ month?: string; day?: string; error?: string; import?: string }>;
}) {
  const { client } = await requireSession();
  const params = await searchParams;
  const { data: account, error } = await getDimeAccount(client);

  if (!account) {
    return <>
      <header className="page-header"><h1>Dashboard</h1></header>
      <p className="notice" role="alert">{error ? "Could not load the Dime account." : "No Dime USD account is configured for this journal."}</p>
    </>;
  }

  type TradeTotals = { gross: string; trades: number; wins: number; latest_day: string | null };
  const { data: totals, error: totalsError } = await client
    .rpc("journal_dashboard_totals", { target_account: account.id })
    .select("gross,trades,wins,latest_day")
    .single<TradeTotals>();
  const metrics = totals ? [
    ["Gross P&L", totals.trades ? signedUsd(cents(totals.gross)) : "—"],
    ["Closed trades", String(totals.trades)],
    ["Win rate", totals.trades ? `${(totals.wins / totals.trades * 100).toFixed(1)}%` : "—"],
  ] : [];
  const defaultMonth = (totals?.latest_day ?? new Date().toISOString()).slice(0, 7);
  const initialMonth = isJournalMonth(params.month) ? params.month : defaultMonth;
  const initialDay = typeof params.day === "string" ? params.day : undefined;
  const monthlyTrades = await getMonthlyTrades(client, account.id, initialMonth, account.timezone);
  const importSearch = new URLSearchParams({ import: "true" });
  if (isJournalMonth(params.month)) importSearch.set("month", params.month);
  if (initialDay) importSearch.set("day", initialDay);

  return (
    <>
      <header className="page-header split">
        <h1>Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link id="trade-history" href="/trade-history" prefetch={false} className={buttonVariants({ variant: "outline" })}>
            View Trade History
          </Link>
          <DimeImportModal account={account.id}
            initiallyOpen={params.import === "true"} fallbackHref={`/?${importSearch}`} />
        </div>
      </header>
      {totalsError && <p className="notice" role="alert">Trade totals could not be loaded. Check the import migration.</p>}
      {totals && (
        <div className="mb-5 grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3" role="list" aria-label="Summary metrics">
          <Card role="listitem" className="col-span-2 sm:col-span-1 min-w-0">
            <CardHeader className="px-3 sm:px-4 pb-1">
              <CardTitle className="text-xs leading-snug text-muted-foreground sm:text-sm">Gross P&amp;L</CardTitle>
            </CardHeader>
            <CardContent className="dashboard-amount px-3 pb-3 sm:px-4">
              <div className={`text-2xl sm:text-3xl font-bold tracking-tight font-mono ${totals.trades && cents(totals.gross) > 0n
                  ? "text-emerald-500 dark:text-emerald-400"
                  : totals.trades && cents(totals.gross) < 0n
                    ? "text-rose-500 dark:text-rose-400"
                    : "text-foreground"
                }`}>
                {totals.trades ? signedUsd(cents(totals.gross)) : "—"}
              </div>
              {totals.trades ? (
                <div className={`text-xs sm:text-sm font-mono font-normal mt-0.5 ${cents(totals.gross) > 0n
                    ? "text-emerald-600/80 dark:text-emerald-400/80"
                    : cents(totals.gross) < 0n
                      ? "text-rose-600/80 dark:text-rose-400/80"
                      : "text-muted-foreground"
                  }`}>
                  {formatThbEstimate(cents(totals.gross))}
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card role="listitem" className="col-span-1 min-w-0">
            <CardHeader className="px-3 sm:px-4 pb-1">
              <CardTitle className="text-xs leading-snug text-muted-foreground sm:text-sm">Closed trades</CardTitle>
            </CardHeader>
            <CardContent className="dashboard-amount px-3 pb-3 text-xl sm:text-2xl font-bold tracking-tight font-mono">
              {String(totals.trades)}
            </CardContent>
          </Card>
          <Card role="listitem" className="col-span-1 min-w-0">
            <CardHeader className="px-3 sm:px-4 pb-1">
              <CardTitle className="text-xs leading-snug text-muted-foreground sm:text-sm">Win rate</CardTitle>
            </CardHeader>
            <CardContent className="dashboard-amount px-3 pb-3 text-xl sm:text-2xl font-bold tracking-tight font-mono">
              {totals.trades ? `${(totals.wins / totals.trades * 100).toFixed(1)}%` : "—"}
            </CardContent>
          </Card>
        </div>
      )}
      <MonthlyReview key={`${account.id}/${initialMonth}/${initialDay ?? ""}`} account={account.id}
        initialMonth={initialMonth} initialDay={initialDay} initialTrades={monthlyTrades} timeZone={account.timezone} />
    </>
  );
}
