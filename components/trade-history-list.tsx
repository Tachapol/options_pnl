import type { ReactNode } from "react";
import { ExecutionTable } from "@/components/execution-table";
import type { TradeExecution } from "@/lib/trade-executions";
import { cents, signedUsd } from "@/lib/summary-csv";

type TradeAmount = {
  value: string;
  tone?: "gain" | "loss";
};

export type HistoryTransaction = {
  id: string;
  day: string;
  symbol: string;
  contract: string;
  expiration: string;
  quantity?: number;
  executions: TradeExecution[];
  gross?: TradeAmount;
  status?: string;
  evidence?: ReactNode;
};

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
});
const expirationFormat = new Intl.DateTimeFormat("en-GB", {
  month: "short", day: "numeric", timeZone: "UTC",
});

export function grossTradeAmount(value: string): TradeAmount {
  const amount = cents(value);
  return {
    value: signedUsd(amount),
    tone: amount > 0n ? "gain" : amount < 0n ? "loss" : undefined,
  };
}

export function TradeHistoryList({ transactions }: { transactions: HistoryTransaction[] }) {
  const days = new Map<string, HistoryTransaction[]>();
  for (const transaction of transactions) {
    const group = days.get(transaction.day);
    if (group) group.push(transaction);
    else days.set(transaction.day, [transaction]);
  }

  return <div className="grid gap-4">
    {[...days].map(([day, rows]) => (
      <div key={day}>
        <h3 className="rounded-md bg-muted px-3 py-2 text-sm font-semibold muted">
          <time dateTime={day}>{dateFormat.format(new Date(`${day}T00:00:00Z`))}</time>
        </h3>
        <ul className="divide-y divide-border">
          {rows.map((row) => <TradeHistoryRow key={row.id} row={row} />)}
        </ul>
      </div>
    ))}
  </div>;
}

function TradeHistoryRow({ row }: { row: HistoryTransaction }) {
  return (
    <li className="px-1 py-2.5 sm:px-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div>
          <strong className="text-base [overflow-wrap:anywhere]">{row.symbol} {row.contract}</strong>
          <p className="mt-1 text-sm muted">Exp. <time dateTime={row.expiration}>
            {expirationFormat.format(new Date(`${row.expiration}T00:00:00Z`))}
          </time></p>
        </div>
        <div className="grid max-w-[min(42vw,14rem)] justify-items-end gap-1 text-right tabular-nums">
          {row.quantity !== undefined && (
            <p className="text-sm font-semibold [overflow-wrap:anywhere]">
              {row.quantity} {row.quantity === 1 ? "contract" : "contracts"}
            </p>
          )}
          {row.gross && (
            <p className="history-amount max-w-full whitespace-nowrap text-sm font-semibold" data-tone={row.gross.tone}>
              <span className="sr-only">Gross P&amp;L </span>{row.gross.value}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 border-t border-border/30 pt-1">
        <ExecutionTable executions={row.executions} />
      </div>
      {(row.status || row.evidence) && (
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 text-xs muted">
          {row.status && <span>{row.status}</span>}
          {row.evidence}
        </div>
      )}
    </li>
  );
}
