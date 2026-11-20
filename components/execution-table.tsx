import { executionTotal, formatExecutionTime, type TradeExecution } from "@/lib/trade-executions";
import { signedUsd } from "@/lib/summary-csv";

export function ExecutionTable({ executions }: { executions: TradeExecution[] }) {
  if (!executions.length) return <p className="py-2 text-xs text-muted-foreground">Execution details unavailable.</p>;

  return (
    <div className="execution-table-container">
      <table role="table" className="execution-table w-full text-xs sm:text-sm" aria-label="Transactions">
        <thead role="rowgroup" className="execution-table-heading text-muted-foreground">
          <tr role="row" className="border-b border-border/30 text-left">
            <th scope="col" role="columnheader" className="pb-2 font-medium">Action</th>
            <th scope="col" role="columnheader" className="pb-2 font-medium">Time</th>
            <th scope="col" role="columnheader" className="pb-2 text-right font-medium">Price</th>
            <th scope="col" role="columnheader" className="pb-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="divide-y divide-border/30">
          {executions.map((execution, index) => {
            const total = executionTotal(execution);
            return (
              <tr role="row" className="execution-row" key={index}>
                <td role="cell" className="execution-action font-semibold text-foreground">
                  {execution.side.toUpperCase()}
                  {execution.quantity !== null && (
                    <span className="ml-1 whitespace-nowrap font-normal text-muted-foreground">×{execution.quantity}</span>
                  )}
                </td>
                <td role="cell" className="execution-time font-mono text-muted-foreground">
                  <time dateTime={execution.executedAt ?? undefined}>{formatExecutionTime(execution)}</time>
                </td>
                <td role="cell" className="execution-price text-right text-foreground">
                  <span aria-hidden="true" className="execution-mobile-label">Price </span>
                  <span className="whitespace-nowrap font-mono tabular-nums">{execution.price === null ? "—" : `$${execution.price}`}</span>
                </td>
                <td role="cell" className="execution-total text-right text-foreground">
                  <span aria-hidden="true" className="execution-mobile-label">Total </span>
                  <span className="whitespace-nowrap font-mono tabular-nums">{total === null ? "—" : signedUsd(total).replace(/^\+/, "")}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {executions.some(({ quantity, price }) => quantity === null || price === null) && (
        <p className="mt-2 text-xs text-muted-foreground">Individual fill sizes or prices are unavailable in the source.</p>
      )}
    </div>
  );
}
