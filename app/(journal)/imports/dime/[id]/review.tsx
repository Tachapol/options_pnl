"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fieldKeys, fields, labels, missingFields, type Fill } from "@/lib/dime";
import { confirmDime } from "./actions";

type Key = keyof Fill;
type Resolution = "unresolved" | "duplicate" | "distinct";
type Overlap = "csv" | "fill" | "broker_id";
export type ReviewRecord = {
  id: string; ordinal: number; row: Fill; decision: string | null; overlap: Overlap | null; evidence?: string[];
};
const overlapText = {
  csv: "Possible CSV overlap. Compare dates, quantities, prices and times in Trade History.",
  fill: "Possible overlap with another screenshot fill. Compare the execution in Trade History.",
  broker_id: "This broker fill ID is already in Trade History.",
};
const options: Partial<Record<Key, string[]>> = {
  status: ["filled", "partial", "pending", "cancelled"], option_type: ["Call", "Put"],
  side: ["Buy", "Sell", "Sell to open", "Buy to close"],
};
const isUnexecuted = (row: Fill) => row.status === "pending" || row.status === "cancelled";
const hasExecution = (row: Fill) => row.quantity !== null || row.price !== null;
function problems(record: ReviewRecord) {
  return [
    ...missingFields(record.row).map((key) => labels[key] + " missing"),
    ...(record.overlap ? [overlapText[record.overlap]] : []),
    ...(record.row.side?.includes(" to ") && !isUnexecuted(record.row) ? ["Short options require separate accounting."] : []),
    ...(isUnexecuted(record.row) && hasExecution(record.row) ? ["Verify status against the visible execution evidence."] : []),
  ];
}

export function DimeReview({ image, account, records }: { image: string; account: string; records: ReviewRecord[] }) {
  const [rows, setRows] = useState(records);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [edits, setEdits] = useState<Record<string, Partial<Record<Key, string>>>>({});
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function resolution(record: ReviewRecord): Resolution {
    return resolutions[record.id] ?? "unresolved";
  }
  function ready(record: ReviewRecord) {
    if (record.decision || Object.keys(edits[record.id] ?? {}).length) return false;
    if (isUnexecuted(record.row)) return !hasExecution(record.row);
    if (record.overlap && resolution(record) === "duplicate") return true;
    return !missingFields(record.row).length && (record.row.side === "Buy" || record.row.side === "Sell")
      && (!record.overlap || record.overlap === "broker_id" || resolution(record) === "distinct");
  }
  const readyRows = rows.filter(ready);

  function update(id: string, key: Key, value: string) {
    const parsed = fields[key].safeParse(key === "quantity" ? Number(value) : value);
    setEdits((current) => {
      const next = { ...current[id] };
      if (!value || parsed.success) delete next[key];
      else next[key] = value;
      return { ...current, [id]: next };
    });
    if (!value || parsed.success) {
      setRows((current) => current.map((item) => item.id === id
        ? { ...item, row: { ...item.row, [key]: value ? parsed.data : null },
          ...(key !== "order_type" ? { overlap: null, evidence: undefined } : {}) } : item));
      if (key !== "order_type") {
        setResolutions((current) => ({ ...current, [id]: "unresolved" }));
      }
    }
  }

  function confirm() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await confirmDime(image, readyRows.map((record) => ({
          id: record.id, row: record.row, resolution: resolution(record),
        })));
        if (result.error) {
          setMessage(result.error);
          if (result.overlapId && result.overlap) setRows((current) => current.map((item) =>
            item.id === result.overlapId ? { ...item, overlap: result.overlap } : item));
          return;
        }
        const decisions = new Map(result.decisions?.map((record) => [record.id, record.decision]));
        setRows((current) => current.map((record) =>
          decisions.get(record.id) ? { ...record, decision: decisions.get(record.id) } : record));
        setMessage(result.count ? `${result.count} reviewed item(s) saved.` : "These items were already processed.");
      } catch {
        setMessage("Could not finish confirmation. Retry safely.");
      }
    });
  }

  function field(record: ReviewRecord, key: Key) {
    const invalidValue = edits[record.id]?.[key];
    const value = invalidValue ?? String(record.row[key] ?? "");
    return <label key={key} className="grid gap-1 text-sm">
      {labels[key]}
      {options[key] ? <select className="min-h-11 rounded-md border border-border bg-background px-3"
        value={value} onChange={(event) => update(record.id, key, event.target.value)}>
        <option value="">Unknown</option>
        {options[key].map((choice) => <option key={choice}>{choice}</option>)}
      </select> : <Input className="min-h-11" value={value} aria-invalid={invalidValue !== undefined}
        placeholder={key === "clock" ? "HH:MM or HH:MM:SS" : key === "day" || key === "expiration" ? "YYYY-MM-DD" : undefined}
        inputMode={key === "quantity" ? "numeric" : ["strike", "price"].includes(key) ? "decimal" : undefined}
        onChange={(event) => update(record.id, key, event.target.value)} />}
      {invalidValue !== undefined && <span className="text-destructive">Check this value.</span>}
    </label>;
  }

  function card(record: ReviewRecord) {
    const alerts = problems(record);
    const original = records.find((item) => item.id === record.id);
    const quickFields = original ? missingFields(original.row) : [];
    // Issue #9: semantic badge colors — green = ready, amber = needs attention, grey = done
    const badgeClass = record.decision
      ? "badge-done"
      : ready(record) ? "badge-ready" : "badge-needs-review";
    return <Card key={record.id}><CardContent className="grid gap-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Item {record.ordinal} · {record.row.symbol ?? "Unknown contract"} {record.row.strike} {record.row.option_type}</h3>
        <span className={`rounded-full border px-2 py-1 text-xs font-medium ${badgeClass}`}>
          {record.decision ?? (ready(record) ? "Ready" : "Needs review")}
        </span>
      </div>
      {!record.decision && !!alerts.length && <ul className="rounded-md bg-muted p-3 text-sm">
        {alerts.map((alert) => <li key={alert}>{alert}</li>)}
      </ul>}
      {!record.decision && !!record.evidence?.length && <div className="text-sm">
        <p className="font-medium">Matching CSV candidates</p>
        <ul className="mt-1 divide-y divide-border">
          {record.evidence.map((entry, index) => <li className="break-words py-2 text-muted-foreground" key={index}>{entry}</li>)}
        </ul>
      </div>}
      {!record.decision && record.overlap && record.overlap !== "broker_id" &&
        <label className="grid gap-1 text-sm">Overlap resolution
          <select className="min-h-11 rounded-md border border-border bg-background px-3"
            value={resolution(record)} onChange={(event) => setResolutions((current) =>
              ({ ...current, [record.id]: event.target.value as Resolution }))}>
            <option value="unresolved">Select after comparing evidence</option>
            <option value="duplicate">Already represented in history</option>
            <option value="distinct">Evidence shows a distinct fill</option>
          </select>
        </label>}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {fieldKeys.filter((key) => record.row[key] !== null).map((key) => <div className="min-w-0" key={key}>
          <dt className="text-muted-foreground">{labels[key]}</dt>
          <dd className="break-words">{record.row[key]}</dd>
        </div>)}
      </dl>
      {!record.decision && <fieldset className="grid gap-3" disabled={pending}>
        {!!quickFields.length && <div className="grid gap-3 sm:grid-cols-2">{quickFields.map((key) => field(record, key))}</div>}
        <details>
          <summary className="min-h-10 cursor-pointer py-2 text-sm text-link">Correct another field</summary>
          <div className="grid gap-3 sm:grid-cols-2">
            {fieldKeys.filter((key) => !quickFields.some((quick) => quick === key)).map((key) => field(record, key))}
          </div>
        </details>
      </fieldset>}
    </CardContent></Card>;
  }

  // Keep each card mounted while a field is being corrected.
  const ordered = rows.toSorted((a, b) => {
    const rank = (item: ReviewRecord) => item.decision ? 3 : isUnexecuted(item.row) ? 2 : problems(item).length ? 0 : 1;
    return rank(a) - rank(b);
  });
  const groups = [
    { label: "Executions and uncertain status", records: ordered.filter(({ row }) => !isUnexecuted(row)) },
    { label: "Pending and cancelled orders", records: ordered.filter(({ row }) => isUnexecuted(row)) },
  ];
  return <section className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled={!readyRows.length || pending} onClick={confirm}>
        {pending ? "Confirming…" : `Confirm ready items (${readyRows.length})`}
      </Button>
      <Link className="flex min-h-11 items-center text-sm text-link underline" href={`/trade-history?account=${account}`} prefetch={false}
        target="_blank" rel="noreferrer">Compare Trade History</Link>
    </div>
    {message && (
      <div className="notice flex flex-wrap items-center justify-between gap-2" role="status">
        <span>{message}</span>
        {message.includes("saved") && (
          <Link href="/" className="text-sm font-semibold text-link underline inline-flex items-center gap-1">
            View updated Dashboard →
          </Link>
        )}
      </div>
    )}
    {!rows.length && <p className="muted">No items are available for review.</p>}
    {groups.filter((group) => group.records.length).map((group) =>
      <div className="grid gap-3" key={group.label}><h2 className="font-semibold">{group.label}</h2>{group.records.map(card)}</div>)}
  </section>;
}
