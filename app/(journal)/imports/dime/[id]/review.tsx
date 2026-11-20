"use client";

import Link from "next/link";
import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fieldKeys, fields, labels, missingFields, type Fill } from "@/lib/dime";
import { confirmDime } from "./actions";
import { DimeImagePreview } from "@/components/dime-image-preview";

type Key = keyof Fill;
type Resolution = "unresolved" | "duplicate" | "distinct";
type Overlap = "csv" | "fill" | "broker_id";

export type ReviewRecord = {
  id: string;
  ordinal: number;
  row: Fill;
  decision: string | null;
  overlap: Overlap | null;
  evidence?: string[];
};

const overlapText = {
  csv: "ตรวจพบออเดอร์ในประวัติเดิมที่คล้ายกัน (กรุณาเลือกว่าเป็นรายการซ้ำหรือไม้ใหม่ด้านล่าง)",
  fill: "ตรวจพบออเดอร์จากภาพหน้าจอก่อนหน้าที่คล้ายกัน (กรุณาเลือกว่าเป็นรายการซ้ำหรือไม้ใหม่ด้านล่าง)",
  broker_id: "Broker Fill ID นี้มีอยู่ในระบบแล้ว",
};

const isUnexecuted = (row: Fill) => row.status === "pending" || row.status === "cancelled";
const hasExecution = (row: Fill) => row.quantity !== null || row.price !== null;

function problems(record: ReviewRecord) {
  return [
    ...missingFields(record.row).map((key) => `กรุณาระบุ ${labels[key]}`),
    ...(record.overlap ? [overlapText[record.overlap]] : []),
    ...(record.row.side?.includes(" to ") && !isUnexecuted(record.row) ? ["Short options ต้องใช้การคำนวณแยกต่างหาก"] : []),
    ...(isUnexecuted(record.row) && hasExecution(record.row) ? ["โปรดตรวจสอบสถานะออเดอร์กับภาพหน้าจอ"] : []),
  ];
}

export function DimeReview({
  image,
  account,
  records,
  imageUrl,
  imageFilename,
}: {
  image: string;
  account: string;
  records: ReviewRecord[];
  imageUrl?: string;
  imageFilename?: string;
}) {
  const [rows, setRows] = useState(records);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [edits, setEdits] = useState<Record<string, Partial<Record<Key, string>>>>({});
  const [expandedEditId, setExpandedEditId] = useState<string | null>(null);
  const [peekOpen, setPeekOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function resolution(record: ReviewRecord): Resolution {
    return resolutions[record.id] ?? "unresolved";
  }

  function ready(record: ReviewRecord) {
    if (record.decision || Object.keys(edits[record.id] ?? {}).length) return false;
    if (isUnexecuted(record.row)) return !hasExecution(record.row);
    if (record.overlap && resolution(record) === "duplicate") return true;
    return (
      !missingFields(record.row).length &&
      (record.row.side === "Buy" || record.row.side === "Sell") &&
      (!record.overlap || record.overlap === "broker_id" || resolution(record) === "distinct")
    );
  }

  const readyRows = rows.filter(ready);
  const allConfirmed = rows.length > 0 && rows.every((r) => r.decision !== null);

  // Keyboard shortcut: Cmd/Ctrl + Enter to confirm ready items
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (readyRows.length > 0 && !pending) {
          e.preventDefault();
          confirm();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [readyRows.length, pending]);

  function update(id: string, key: Key, value: string) {
    const parsed = fields[key].safeParse(key === "quantity" ? Number(value) : value);
    setEdits((current) => {
      const next = { ...current[id] };
      if (!value || parsed.success) delete next[key];
      else next[key] = value;
      return { ...current, [id]: next };
    });
    if (!value || parsed.success) {
      setRows((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                row: { ...item.row, [key]: value ? parsed.data : null },
                ...(key !== "order_type" ? { overlap: null, evidence: undefined } : {}),
              }
            : item
        )
      );
      if (key !== "order_type") {
        setResolutions((current) => ({ ...current, [id]: "unresolved" }));
      }
    }
  }

  function confirm() {
    setMessage("");
    startTransition(async () => {
      try {
        const result = await confirmDime(
          image,
          readyRows.map((record) => ({
            id: record.id,
            row: record.row,
            resolution: resolution(record),
          }))
        );
        if (result.error) {
          setMessage(result.error);
          if (result.overlapId && result.overlap)
            setRows((current) =>
              current.map((item) =>
                item.id === result.overlapId ? { ...item, overlap: result.overlap } : item
              )
            );
          return;
        }
        const decisions = new Map(result.decisions?.map((record) => [record.id, record.decision]));
        setRows((current) =>
          current.map((record) =>
            decisions.get(record.id) ? { ...record, decision: decisions.get(record.id) } : record
          )
        );
        setMessage(result.count ? `✓ ${result.count} reviewed trade(s) saved.` : "These items were already processed.");
      } catch {
        setMessage("Could not finish confirmation. Please retry safely.");
      }
    });
  }

  // Quick field editor for missing values
  function renderField(record: ReviewRecord, key: Key) {
    const invalidValue = edits[record.id]?.[key];
    const value = invalidValue ?? String(record.row[key] ?? "");

    if (key === "side") {
      return (
        <div key={key} className="grid gap-1 text-xs">
          <span className="text-muted-foreground font-medium">{labels[key]}</span>
          <div className="flex rounded-lg bg-muted/50 p-1">
            {["Buy", "Sell"].map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => update(record.id, key, choice)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  value === choice
                    ? choice === "Buy"
                      ? "bg-emerald-500 text-black shadow-xs"
                      : "bg-rose-500 text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (key === "option_type") {
      return (
        <div key={key} className="grid gap-1 text-xs">
          <span className="text-muted-foreground font-medium">{labels[key]}</span>
          <div className="flex rounded-lg bg-muted/50 p-1">
            {["Call", "Put"].map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => update(record.id, key, choice)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                  value === choice
                    ? choice === "Call"
                      ? "bg-emerald-500 text-black shadow-xs"
                      : "bg-rose-500 text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (key === "status") {
      return (
        <div key={key} className="grid gap-1 text-xs">
          <span className="text-muted-foreground font-medium">{labels[key]}</span>
          <select
            className="min-h-10 rounded-lg border border-border bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-primary"
            value={value}
            onChange={(event) => update(record.id, key, event.target.value)}
          >
            <option value="">Unknown</option>
            {["filled", "partial", "pending", "cancelled"].map((choice) => (
              <option key={choice} value={choice}>{choice.toUpperCase()}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <label key={key} className="grid gap-1 text-xs">
        <span className="text-muted-foreground font-medium">{labels[key]}</span>
        <Input
          className="min-h-10 text-xs font-mono"
          value={value}
          aria-invalid={invalidValue !== undefined}
          placeholder={
            key === "clock"
              ? "HH:MM:SS"
              : key === "day" || key === "expiration"
              ? "YYYY-MM-DD"
              : key === "price"
              ? "e.g. 3.45"
              : key === "quantity"
              ? "e.g. 1"
              : undefined
          }
          inputMode={key === "quantity" ? "numeric" : ["strike", "price"].includes(key) ? "decimal" : undefined}
          onChange={(event) => update(record.id, key, event.target.value)}
        />
        {invalidValue !== undefined && <span className="text-[11px] text-destructive">Invalid format</span>}
      </label>
    );
  }

  function renderTradeCard(record: ReviewRecord) {
    const alerts = problems(record);
    const original = records.find((item) => item.id === record.id);
    const missing = original ? missingFields(original.row) : [];
    const isReady = ready(record);
    const isConfirmed = Boolean(record.decision);
    const isCall = record.row.option_type === "Call";
    const isBuy = record.row.side === "Buy";
    const isEditing = expandedEditId === record.id;

    // Card border styling
    const borderStyle = isConfirmed
      ? "border-border/60 bg-card/40 opacity-80"
      : isReady
      ? "border-emerald-500/30 bg-card shadow-xs"
      : "border-amber-500/40 bg-amber-500/[0.02] shadow-xs";

    const totalValue =
      record.row.price && record.row.quantity
        ? (Number(record.row.price) * record.row.quantity * 100).toFixed(2)
        : null;

    return (
      <Card key={record.id} className={`overflow-hidden transition-all ${borderStyle}`}>
        <CardContent className="p-4 sm:p-5 grid gap-4">
          {/* ─── Hero Header ─────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3.5">
            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              <span className="text-xs font-mono font-bold text-muted-foreground">
                #{record.ordinal}
              </span>

              {/* Underlying symbol */}
              <span className="text-lg sm:text-xl font-bold font-mono tracking-tight text-foreground">
                {record.row.symbol ?? "UNKNOWN"}
              </span>

              {/* Option type badge */}
              {record.row.option_type && (
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                    isCall
                      ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                      : "bg-rose-500/15 text-rose-500 border border-rose-500/30"
                  }`}
                >
                  {record.row.strike ? `$${record.row.strike} ` : ""}{record.row.option_type}
                </span>
              )}

              {/* Side pill */}
              {record.row.side && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                    isBuy
                      ? "bg-emerald-500 text-black"
                      : "bg-rose-500 text-white"
                  }`}
                >
                  {record.row.side}
                </span>
              )}

              {/* Expiration date */}
              {record.row.expiration && (
                <span className="text-xs text-muted-foreground font-mono">
                  Exp {record.row.expiration}
                </span>
              )}
            </div>

            {/* Status indicator badge */}
            <div className="flex items-center gap-2">
              {isConfirmed ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <span aria-hidden="true">✓</span> Saved
                </span>
              ) : isReady ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-500 border border-emerald-500/20">
                  <span aria-hidden="true">✓</span> Ready to Save
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-500 border border-amber-500/20 animate-pulse">
                  <span aria-hidden="true">⚠</span> Needs Review
                </span>
              )}
            </div>
          </div>

          {/* ─── Key Metrics Grid (At-a-Glance) ────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-muted/30 rounded-xl p-3 border border-border/50">
            <div>
              <div className="text-[11px] font-medium text-muted-foreground">Quantity</div>
              <div className="text-sm sm:text-base font-bold font-mono mt-0.5 text-foreground">
                {record.row.quantity ? `${record.row.quantity} contracts` : <span className="text-amber-500 font-normal">Missing</span>}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-muted-foreground">Fill Price</div>
              <div className="text-sm sm:text-base font-bold font-mono mt-0.5 text-foreground">
                {record.row.price ? `$${record.row.price}` : <span className="text-amber-500 font-normal">Missing</span>}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-muted-foreground">Total Notional</div>
              <div className="text-sm sm:text-base font-bold font-mono mt-0.5 text-foreground">
                {totalValue ? `$${totalValue}` : "—"}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-muted-foreground">Execution Time</div>
              <div className="text-xs sm:text-sm font-mono mt-0.5 text-foreground truncate">
                {record.row.day ?? ""} {record.row.clock ?? <span className="text-amber-500 font-normal">Time missing</span>}
              </div>
            </div>
          </div>

          {/* ─── Attention Alerts ──────────────────────────────────── */}
          {!isConfirmed && alerts.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 grid gap-1">
              <div className="font-semibold flex items-center gap-1.5">
                <span>⚠</span> Attention required before confirming:
              </div>
              <ul className="list-disc list-inside ml-1 space-y-0.5 text-amber-500/90">
                {alerts.map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ─── Overlap Resolution (Intuitive Action Buttons) ─────── */}
          {!isConfirmed && record.overlap && record.overlap !== "broker_id" && (
            <div className="rounded-xl border border-amber-500/30 bg-card p-4 grid gap-3.5 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-border/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-amber-500 font-bold text-xs">
                    ?
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    ตรวจพบรายการที่อาจซ้ำกันในระบบ
                  </span>
                </div>
                <span className="text-[11px] font-medium text-amber-500">
                  {resolution(record) === "unresolved" ? "⚠️ โปรดเลือก 1 ข้อเพื่อยืนยัน" : "✓ บันทึกการเลือกแล้ว"}
                </span>
              </div>

              <p className="text-xs text-muted-foreground">
                ระบบพบออเดอร์ในประวัติเทรดเดิมที่มีสัญญา วันที่ หรือราคาตรงกัน กรุณาเลือก:
              </p>

              {record.evidence && record.evidence.length > 0 && (
                <div className="rounded-lg bg-muted/50 p-2.5 text-xs font-mono text-muted-foreground">
                  <span className="font-semibold text-foreground">ข้อมูลที่ตรงกันในประวัติ:</span>
                  <ul className="mt-1 space-y-1">
                    {record.evidence.map((entry, idx) => (
                      <li key={idx} className="truncate">↳ {entry}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Two clear, distinct action buttons */}
              <div className="grid gap-2.5 sm:grid-cols-2 pt-1">
                {/* Button 1: Duplicate (Skip) */}
                <button
                  type="button"
                  onClick={() =>
                    setResolutions((current) => ({ ...current, [record.id]: "duplicate" }))
                  }
                  className={`group relative rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                    resolution(record) === "duplicate"
                      ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/50 shadow-xs"
                      : "border-border bg-card/60 hover:border-amber-500/40 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        resolution(record) === "duplicate"
                          ? "bg-amber-500 text-black"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        ✕
                      </span>
                      <strong className="text-xs sm:text-sm font-bold text-foreground">
                        มีในระบบแล้ว (รายการซ้ำ)
                      </strong>
                    </div>
                    {resolution(record) === "duplicate" && (
                      <span className="text-[11px] font-bold text-amber-500">
                        ✓ เลือกแล้ว
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed pl-8">
                    ออเดอร์นี้เคยบันทึกไปแล้ว ไม่ต้องนำเข้าซ้ำ (ข้ามไม้นี้)
                  </p>
                </button>

                {/* Button 2: New Distinct Fill (Import) */}
                <button
                  type="button"
                  onClick={() =>
                    setResolutions((current) => ({ ...current, [record.id]: "distinct" }))
                  }
                  className={`group relative rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
                    resolution(record) === "distinct"
                      ? "border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/50 shadow-xs"
                      : "border-border bg-card/60 hover:border-emerald-500/40 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        resolution(record) === "distinct"
                          ? "bg-emerald-500 text-black"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        ✓
                      </span>
                      <strong className="text-xs sm:text-sm font-bold text-foreground">
                        เป็นไม้ใหม่ (บันทึกเพิ่ม)
                      </strong>
                    </div>
                    {resolution(record) === "distinct" && (
                      <span className="text-[11px] font-bold text-emerald-500">
                        ✓ เลือกแล้ว
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground leading-relaxed pl-8">
                    เป็นคนละออเดอร์ที่เทรดเพิ่ม บันทึกเข้าพอร์ตตามปกติ
                  </p>
                </button>
              </div>

              {resolution(record) === "unresolved" && (
                <div className="text-center py-1">
                  <span className="text-xs text-amber-500 font-medium animate-pulse">
                    👆 กรุณากดเลือกปุ่มใดปุ่มหนึ่งข้างบน เพื่อดำเนินการบันทึก
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ─── Missing Fields Quick-Fix ─────────────────────────── */}
          {!isConfirmed && missing.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-card p-3.5 grid gap-3">
              <span className="text-xs font-semibold text-foreground">
                Provide Missing Required Values:
              </span>
              <div className="grid gap-3 sm:grid-cols-2">
                {missing.map((key) => renderField(record, key))}
              </div>
            </div>
          )}

          {/* ─── Collapsible Detailed Editor ───────────────────────── */}
          {!isConfirmed && (
            <div className="border-t border-border/60 pt-2">
              <button
                type="button"
                onClick={() => setExpandedEditId(isEditing ? null : record.id)}
                className="flex items-center gap-1.5 text-xs font-medium text-link hover:underline cursor-pointer py-1"
              >
                <span>{isEditing ? "▾ Hide trade editor" : "▸ Edit all trade fields (Side, Price, Expiry, IDs)"}</span>
              </button>

              {isEditing && (
                <fieldset disabled={pending} className="mt-3 grid gap-3 rounded-xl border border-border bg-muted/20 p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {fieldKeys
                      .filter((key) => !(missing as string[]).includes(key))
                      .map((key) => renderField(record, key))}
                  </div>
                </fieldset>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      {/* ─── Desktop Sticky Screenshot Viewer ───────────────────────── */}
      <div className="hidden lg:block lg:sticky lg:top-4">
        <Card className="overflow-hidden border border-border bg-card shadow-sm">
          <CardContent className="p-4 grid gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate max-w-[200px]">
                {imageFilename || "Original Screenshot"}
              </span>
              <span className="text-[11px] text-muted-foreground">Click to Zoom</span>
            </div>
            {imageUrl && <DimeImagePreview src={imageUrl} alt={imageFilename || "Original Screenshot"} />}
          </CardContent>
        </Card>
      </div>

      {/* ─── Mobile Screenshot Banner & Floating Peek ──────────────── */}
      <div className="lg:hidden">
        {imageUrl && (
          <Card className="overflow-hidden border border-border bg-card">
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold truncate text-foreground">
                  {imageFilename || "Dime Screenshot"}
                </div>
                <div className="text-[11px] text-muted-foreground">Tap below to inspect & compare</div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPeekOpen(true)}
                className="min-h-10 text-xs font-semibold gap-1.5 shrink-0 cursor-pointer"
              >
                <span>🔍 Inspect Screenshot</span>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ─── Main Review Stream ────────────────────────────────────── */}
      <section className="grid min-w-0 gap-4 pb-24">
        {message && (
          <div className="notice flex flex-wrap items-center justify-between gap-2 rounded-xl text-sm" role="status">
            <span className="font-medium">{message}</span>
            {message.includes("saved") && (
              <Link href="/" className="text-xs font-bold text-link underline inline-flex items-center gap-1">
                View Dashboard →
              </Link>
            )}
          </div>
        )}

        {/* All items completed celebration */}
        {allConfirmed && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center shadow-xs">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-black font-bold text-xl">
              ✓
            </div>
            <h3 className="text-base sm:text-lg font-bold text-foreground">All Trades Confirmed!</h3>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
              Every execution in this screenshot has been reconciled and added to your options journal.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 shadow-xs"
              >
                Go to Dashboard →
              </Link>
              <Link
                href={`/trade-history?account=${account}`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"
              >
                View Trade History
              </Link>
              <Link
                href="/imports"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-foreground hover:bg-muted"
              >
                Upload Another Screenshot
              </Link>
            </div>
          </div>
        )}

        {/* Items List */}
        {!rows.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No items were found in this screenshot.
          </p>
        ) : (
          <div className="grid gap-6">
            {rows.filter((r) => !isUnexecuted(r.row)).length > 0 && (
              <div className="grid gap-3">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    รายการเทรดที่ตรวจพบ ({rows.filter((r) => !isUnexecuted(r.row)).length})
                  </h3>
                </div>
                <div className="grid gap-3.5">
                  {rows.filter((r) => !isUnexecuted(r.row)).map(renderTradeCard)}
                </div>
              </div>
            )}

            {rows.filter((r) => isUnexecuted(r.row)).length > 0 && (
              <div className="grid gap-3 pt-2">
                <div className="flex items-center gap-2 px-1">
                  <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-muted-foreground">
                    คำสั่งที่รอหรือถูกยกเลิก ({rows.filter((r) => isUnexecuted(r.row)).length})
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    (ไม่มีการซื้อขายเกิดขึ้นจริง)
                  </span>
                </div>
                <div className="grid gap-3.5">
                  {rows.filter((r) => isUnexecuted(r.row)).map(renderTradeCard)}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── Sticky Bottom Action Bar ───────────────────────────────── */}
      <footer className="review-sticky-bar fixed inset-x-0 bottom-0 p-3 sm:p-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {readyRows.length > 0 ? (
              <span className="text-xs sm:text-sm font-semibold text-emerald-500 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                {readyRows.length} of {rows.length} ready to save
              </span>
            ) : allConfirmed ? (
              <span className="text-xs sm:text-sm font-semibold text-muted-foreground">
                All items saved
              </span>
            ) : (
              <span className="text-xs sm:text-sm font-semibold text-amber-500 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                Action required on {rows.length - readyRows.length} item(s)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href={`/trade-history?account=${account}`}
              target="_blank"
              rel="noreferrer"
              className="hidden sm:inline-flex min-h-10 items-center text-xs font-medium text-link underline"
            >
              Compare History ↗
            </Link>

            <Button
              disabled={readyRows.length === 0 || pending}
              onClick={confirm}
              className="min-h-11 px-5 font-semibold gap-2 shadow-xs cursor-pointer text-xs sm:text-sm"
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                  กำลังบันทึก…
                </>
              ) : (
                <>
                  <span>บันทึก {readyRows.length} รายการที่พร้อม</span>
                  <kbd className="hidden md:inline-block rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-mono">
                    ⌘↵
                  </kbd>
                </>
              )}
            </Button>
          </div>
        </div>
      </footer>

      {/* ─── Mobile Floating Quick Peek Drawer / Modal ──────────────── */}
      {peekOpen && imageUrl && (
        <div
          role="dialog"
          aria-label="Floating screenshot peek"
          aria-modal="true"
          className="peek-drawer-overlay flex flex-col justify-end lg:hidden animate-in fade-in"
          onClick={() => setPeekOpen(false)}
        >
          <div
            className="relative max-h-[85vh] w-full rounded-t-2xl border-t border-border bg-card p-4 shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                Original Screenshot
              </span>
              <button
                type="button"
                onClick={() => setPeekOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-full bg-muted/60 text-foreground hover:bg-muted font-bold"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto py-2">
              <DimeImagePreview src={imageUrl} alt={imageFilename || "Original Screenshot"} />
            </div>
            <div className="pt-2 text-center text-xs text-muted-foreground">
              Tap anywhere outside or ✕ to return to review form
            </div>
          </div>
        </div>
      )}
    </div>
  );
}