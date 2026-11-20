"use client";

import { useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PerformanceData } from "@/lib/performance";
import { signedUsd } from "@/lib/summary-csv";

type ViewMode = "equity" | "weekly" | "daily";
type Inspection = { index: number; selectedDay: string | undefined; touch: boolean };

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
const shortDateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const axisUsd = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const axisUnits = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]] as const;

function formatAxisUsd(value: number) {
  const absolute = Math.abs(value);
  const [divisor, suffix] = axisUnits.find(([unit]) => absolute >= unit) ?? [1, ""];
  return `${value < 0 ? "−" : ""}$${axisUsd.format(absolute / divisor)}${suffix}`;
}

function pnlScale(values: number[], top: number, height: number) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const idealStep = low === high ? 1 : (high - low) / 4;
  const base = 10 ** Math.floor(Math.log10(idealStep));
  const step = Math.max(0.01, ([1, 2, 2.5, 5, 10].find((multiple) => multiple * base >= idealStep) ?? 10) * base);
  const first = low === high ? -1 : Math.floor(low / step);
  const last = low === high ? 1 : Math.ceil(high / step);
  const getY = (value: number) => top + ((last - value / step) / (last - first)) * height;
  const axis = Array.from({ length: last - first + 1 }, (_, index) => ({
    value: (first + index) * step,
    y: top + ((last - first - index) / (last - first)) * height,
  }));
  return { getY, zeroY: getY(0), axis };
}

function shortDate(day: string) {
  return shortDateFormat.format(new Date(`${day}T00:00:00Z`));
}

const monthFormat = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const chartModes = [
  ["equity", "Cumulative"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
] as const;

export function PerformanceVisualizer({ month, monthData, allTimeData, selectedDay, onSelectDay }: {
  month: string;
  monthData: PerformanceData | null | undefined;
  allTimeData: PerformanceData | null;
  selectedDay: string | undefined;
  onSelectDay: (day: string) => void;
}) {
  const [scope, setScope] = useState<"month" | "all">("month");
  const [mode, setMode] = useState<ViewMode>("equity");
  const headingId = useId();
  const data = scope === "month" ? monthData : allTimeData;
  const monthStart = scope === "month" ? `${month}-01` : undefined;

  return <Card className="overflow-hidden" aria-labelledby={headingId}>
    <CardHeader className="gap-3 px-3 pb-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle id={headingId}>{mode === "equity" ? "Cumulative P&L" : mode === "daily" ? "Daily P&L" : "Weekly P&L"}</CardTitle>
          <p className="muted mt-1 text-xs">
            {monthStart ? monthFormat.format(new Date(`${monthStart}T00:00:00Z`)) : "All time"} · Gross · USD
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border p-1 text-xs" role="group" aria-label="P&L date range">
          {(["month", "all"] as const).map((range) => (
            <button key={range} type="button" aria-pressed={scope === range} onClick={() => setScope(range)}
              className={`min-h-10 cursor-pointer rounded-md px-3 font-medium ${scope === range ? "bg-primary text-primary-foreground" : "muted"}`}>
              {range === "month" ? "Selected month" : "All time"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="P&L chart type">
        {chartModes.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}
            className={`min-h-10 cursor-pointer rounded-md border px-3 font-medium ${mode === value ? "border-border bg-muted text-foreground" : "border-transparent muted"}`}>
            {label}
          </button>
        ))}
      </div>
    </CardHeader>
    {data && data.dayPoints.length > 0 ? (
      <PerformanceChart key={`${scope === "month" ? month : "all"}/${mode}`} data={data} mode={mode} monthStart={monthStart}
        selectedDay={selectedDay} onSelectDay={onSelectDay} />
    ) : (
      <CardContent className="px-3 text-sm muted sm:px-5" role="status">
        {data === undefined ? "Loading P&L…" : data === null ? "P&L could not be loaded." : "No closed trades in this period."}
      </CardContent>
    )}
  </Card>;
}

function PerformanceChart({ data, mode, monthStart, selectedDay, onSelectDay }: {
  data: PerformanceData;
  mode: ViewMode;
  monthStart: string | undefined;
  selectedDay: string | undefined;
  onSelectDay: (day: string) => void;
}) {
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [showDrawdown, setShowDrawdown] = useState(false);
  const activeIdx = inspection?.selectedDay === selectedDay ? inspection?.index ?? null : null;
  const touchInspection = activeIdx !== null && inspection?.touch;
  const gesture = useRef<{ id: number; startX: number; startY: number; moved: boolean; previous: Inspection | null } | null>(null);
  const mouseClick = useRef(false);
  const chartId = useId();

  function setActiveIdx(index: number | null, touch = false) {
    setInspection((current) => {
      if (index === null) return null;
      if (current?.index === index && current.selectedDay === selectedDay && current.touch === touch) return current;
      return { index, selectedDay, touch };
    });
  }
  const { metrics, dayPoints, weekBars, maxDrawdownRange } = data;

  // Formatting helpers
  const avgWin = signedUsd(BigInt(metrics.avgWinCents));
  const avgLoss = signedUsd(BigInt(metrics.avgLossCents));
  const maxDD = signedUsd(BigInt(metrics.maxDrawdownCents));

  // Profit factor label
  const pf = metrics.profitFactor;
  const pfLabel = pf === null ? "—" : pf.toFixed(2);
  const pfTone = pf === null ? "muted" : pf >= 2.0 ? "text-emerald-400" : pf >= 1.25 ? "text-primary" : pf >= 1.0 ? "text-amber-400" : "text-rose-400";
  const pfBadge = pf === null ? "" : pf >= 2.0 ? "High Edge" : pf >= 1.25 ? "Profitable" : pf >= 1.0 ? "Breakeven" : "Underperforming";

  // Payoff ratio label
  const pr = metrics.winLossRatio;
  const prLabel = pr === null ? "—" : `${pr.toFixed(2)} : 1`;

  // Chart Dimensions
  const W = 800;
  const H = 260;
  const padTop = 24;
  const padBottom = 16;
  const padLeft = 16;
  const padRight = 16;
  const chartW = W - padLeft - padRight;
  const chartH = H - padTop - padBottom;

  // Prepare Points for Equity Mode
  const equityPoints = useMemo(() => {
    const values = dayPoints.map((p) => Number(BigInt(p.cumulativeCents)) / 100);
    const { getY, zeroY, axis } = pnlScale(values, padTop, chartH);

    // Anchor each range at zero and place points by calendar date.
    const start = Date.parse(monthStart ?? dayPoints[0].day) - 86400000;
    const end = Date.parse(dayPoints[dayPoints.length - 1].day);
    const coords = values.map((val, i) => ({
      x: padLeft + ((Date.parse(dayPoints[i].day) - start) / (end - start)) * chartW,
      y: getY(val),
      item: dayPoints[i],
    }));

    const dayWidth = (86400000 / (end - start)) * chartW;
    const pathD = coords.reduce((path, point, index) => {
      const previous = coords[index - 1] ?? { x: padLeft, y: zeroY };
      if (previous.y === point.y) return `${path} H ${point.x}`;

      // Keep gaps between trading days flat and ease into each recorded balance.
      const curveStart = Math.max(previous.x, point.x - dayWidth);
      const controlX = (curveStart + point.x) / 2;
      return `${path} H ${curveStart} C ${controlX} ${previous.y} ${controlX} ${point.y} ${point.x} ${point.y}`;
    }, `M ${padLeft} ${zeroY}`);
    const areaD = `${pathD} V ${zeroY} H ${padLeft} Z`;
    return { coords, pathD, areaD, zeroY, axis };
  }, [dayPoints, chartH, chartW, padLeft, padTop, monthStart]);

  // Prepare Bars for Weekly or Daily Mode
  const { bars: barData, axis: barAxis, zeroY: barZeroY } = useMemo(() => {
    const list = mode === "weekly" ? weekBars : dayPoints;
    const values = list.map((item) => Number(BigInt(item.pnlCents)) / 100);
    const { getY, zeroY, axis } = pnlScale(values, padTop, chartH);

    const slotW = chartW / Math.max(1, list.length);
    const barWidth = Math.max(4, Math.min(slotW * 0.72, 36));

    const bars = list.map((item, i) => {
      const val = values[i];
      const y = getY(val);
      const isGain = val >= 0;
      const x = padLeft + i * slotW + (slotW - barWidth) / 2;
      const barH = Math.abs(zeroY - y);
      const barY = isGain ? y : zeroY;

      return {
        x,
        y: barY,
        tipY: y,
        width: barWidth,
        height: barH,
        isGain,
        item,
        centerX: x + barWidth / 2,
        label: "label" in item ? item.label : shortDate(item.day),
      };
    });
    return { bars, axis, zeroY };
  }, [mode, weekBars, dayPoints, chartH, chartW, padLeft, padTop]);

  const selectedIndex = dayPoints.findIndex((point) => point.day === selectedDay);
  const pointIndex = activeIdx ?? (selectedIndex >= 0 ? selectedIndex : dayPoints.length - 1);
  const activeEquity = equityPoints.coords[pointIndex];
  const equityTooltip = mode === "equity" && activeIdx !== null && !touchInspection ? activeEquity : null;
  const equityDate = dateFormat.format(new Date(`${activeEquity.item.day}T00:00:00Z`));
  const equityCumulative = signedUsd(BigInt(activeEquity.item.cumulativeCents));
  const equityDaily = signedUsd(BigInt(activeEquity.item.pnlCents));
  const canShowDrawdown = mode === "equity" && maxDrawdownRange !== null;
  const drawdown = canShowDrawdown && showDrawdown ? maxDrawdownRange : null;
  const peak = drawdown && (drawdown.peakDay === null
    ? { x: padLeft, y: equityPoints.zeroY }
    : equityPoints.coords.find(({ item }) => item.day === drawdown.peakDay));
  const trough = drawdown && equityPoints.coords.find(({ item }) => item.day === drawdown.troughDay);

  function selectPoint(index: number, touch = false) {
    const day = dayPoints[index].day;
    setInspection({ index, selectedDay: day, touch });
    onSelectDay(day);
  }

  const activeBar = activeIdx === null ? null : barData[activeIdx];
  const mobileBar = activeBar ?? barData.at(-1);
  const barDate = (bar: (typeof barData)[number]) => "label" in bar.item
    ? `Week of ${bar.item.label}`
    : dateFormat.format(new Date(`${bar.item.day}T00:00:00Z`));
  const axis = mode === "equity" ? equityPoints.axis : barAxis;
  const zeroY = mode === "equity" ? equityPoints.zeroY : barZeroY;
  const firstLabel = mode === "equity" ? shortDate(monthStart ?? dayPoints[0].day) : barData[0]?.label;
  const lastLabel = mode === "equity" ? shortDate(dayPoints[dayPoints.length - 1].day) : barData[barData.length - 1]?.label;

  function pointAt(event: PointerEvent<SVGSVGElement>) {
    const plot = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - plot.left) / plot.width) * W;
    if (mode !== "equity") {
      const slot = Math.floor(((x - padLeft) / chartW) * barData.length);
      return Math.max(0, Math.min(barData.length - 1, slot));
    }

    const { coords } = equityPoints;
    const index = coords.findIndex((point, i) => i === coords.length - 1 || x < (point.x + coords[i + 1].x) / 2);
    return index;
  }

  function beginGesture(event: PointerEvent<SVGSVGElement>) {
    if (!event.isPrimary) return;
    mouseClick.current = event.pointerType === "mouse";
    if (mouseClick.current) return;
    gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, previous: inspection };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveIdx(pointAt(event), true);
  }

  function moveGesture(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    const dx = Math.abs(event.clientX - current.startX);
    const dy = Math.abs(event.clientY - current.startY);
    current.moved ||= Math.max(dx, dy) > 5;
    if (dx >= dy) setActiveIdx(pointAt(event), true);
  }

  function endGesture(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    gesture.current = null;
    if (mode === "equity" && !current.moved) selectPoint(pointAt(event), true);
  }

  function cancelGesture(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (current?.id !== event.pointerId) return;
    gesture.current = null;
    setInspection(current.previous);
  }

  return (
      <CardContent className="px-3 pt-1 sm:px-5">
        {mode === "equity" && (
          <dl className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 select-none text-sm tabular-nums [-webkit-touch-callout:none]" aria-live="polite">
            <div className="font-semibold">
              <dt className="sr-only">Session date</dt>
              <dd>{equityDate}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="muted">Cumulative</dt>
              <dd className="font-semibold">{equityCumulative}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="muted">Day P&amp;L</dt>
              <dd>{equityDaily}</dd>
            </div>
          </dl>
        )}
        {mode !== "equity" && mobileBar && (
          <dl className={`mb-2 items-baseline justify-between gap-2 select-none text-sm tabular-nums [-webkit-touch-callout:none] ${touchInspection ? "flex" : "hidden pointer-coarse:flex"}`} aria-live="polite">
            <div className="font-semibold">
              <dt className="sr-only">{mode === "weekly" ? "Trading week" : "Session date"}</dt>
              <dd>{barDate(mobileBar)}</dd>
            </div>
            <div>
              <dt className="sr-only">{mode === "weekly" ? "Week P&L" : "Day P&L"}</dt>
              <dd className={`whitespace-nowrap font-semibold ${mobileBar.isGain ? "text-[var(--gain-text)]" : "text-[var(--loss-text)]"}`}>
                {signedUsd(BigInt(mobileBar.item.pnlCents))}
              </dd>
            </div>
          </dl>
        )}
        <div className="relative w-full select-none rounded-xl border border-border/60 bg-background/50 p-2 [-webkit-touch-callout:none] sm:p-4"
          onContextMenu={(event) => {
            if (gesture.current || window.matchMedia("(pointer: coarse)").matches) event.preventDefault();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse" && !touchInspection) setActiveIdx(null);
          }}>
          <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-1 sm:grid-cols-[3.75rem_minmax(0,1fr)]">
            <div className="relative h-36 text-[11px] tabular-nums muted sm:h-56 sm:text-xs" aria-hidden="true">
              {axis.map(({ value, y }) => (
                <span key={value} className={`absolute right-0 -translate-y-1/2 whitespace-nowrap ${value === 0 ? "font-semibold text-foreground" : ""}`}
                  style={{ top: `${(y / H) * 100}%` }}>
                  {formatAxisUsd(value)}
                </span>
              ))}
            </div>
            <div className="min-w-0">
              <div className="relative touch-pan-y touch-pinch-zoom">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="block h-36 w-full overflow-visible select-none sm:h-56"
                  aria-label={mode === "equity" ? "Daily cumulative P&L chart" : "P&L bar chart"}
                  role={mode === "equity" ? "group" : "img"}
                  tabIndex={mode === "equity" ? 0 : undefined}
                  onPointerDown={beginGesture}
                  onPointerMove={moveGesture}
                  onPointerUp={endGesture}
                  onPointerCancel={cancelGesture}
                  onLostPointerCapture={cancelGesture}
                  aria-keyshortcuts={mode === "equity" ? "ArrowLeft ArrowRight Enter Escape" : undefined}
                  onKeyDown={(event) => {
                    if (mode !== "equity") return;
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault();
                      const offset = event.key === "ArrowLeft" ? -1 : 1;
                      setActiveIdx(Math.max(0, Math.min(dayPoints.length - 1, pointIndex + offset)));
                    }
                    if (event.key === "Enter") selectPoint(pointIndex);
                    if (event.key === "Escape") setActiveIdx(null);
                  }}
                >
                  <defs>
                    <linearGradient id={`grad-gain-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#75d5ab" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="#75d5ab" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id={`grad-loss-${chartId}`} x1="0" y1="1" x2="0" y2="0">
                      <stop offset="0%" stopColor="#f87171" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="#f87171" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  <g stroke="var(--line)" opacity="0.65" className="pointer-events-none">
                    {axis.filter(({ value }) => value !== 0).map(({ value, y }) => (
                      <line key={value} x1={padLeft} x2={W - padRight} y1={y} y2={y}
                        vectorEffect="non-scaling-stroke" />
                    ))}
                  </g>

                  {/* Equity curve */}
                  {mode === "equity" && (
                    <>
                      {peak && trough && (
                        <rect x={peak.x} y={padTop} width={trough.x - peak.x} height={chartH}
                          fill="var(--loss-text)" opacity="0.09" aria-hidden="true" />
                      )}
                      {/* Area fill */}
                      {equityPoints.areaD && (
                        <path d={equityPoints.areaD} fill={`url(#grad-gain-${chartId})`} className="transition-all duration-300" />
                      )}

                      {/* Line Path */}
                      {equityPoints.pathD && (
                        <path
                          d={equityPoints.pathD}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="2"
                          vectorEffect="non-scaling-stroke"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="transition-all duration-300"
                        />
                      )}

                    </>
                  )}

                  {mode !== "equity" && barData.map((bar, i) => (
                    <rect
                      key={"label" in bar.item ? bar.item.weekKey : bar.item.day}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      rx="3"
                      vectorEffect="non-scaling-stroke"
                      className={`cursor-pointer transition-all duration-150 ${
                        bar.isGain
                          ? activeIdx === i ? "fill-emerald-300 stroke-[var(--gain-text)]" : "fill-emerald-500/80 hover:fill-emerald-400"
                          : activeIdx === i ? "fill-rose-400 stroke-[var(--loss-text)]" : "fill-rose-500/80 hover:fill-rose-400"
                      }`}
                    />
                  ))}

                  <line
                    data-zero-baseline=""
                    x1={padLeft}
                    x2={W - padRight}
                    y1={zeroY}
                    y2={zeroY}
                    stroke="var(--muted)"
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                    opacity="0.85"
                    className="pointer-events-none"
                  />

                  {mode === "equity" && (
                    <>
                      {peak && trough && (
                        <g data-drawdown-range="" aria-hidden="true" className="pointer-events-none" stroke="var(--loss-text)" fill="var(--background)">
                          <path d={`M ${peak.x} ${peak.y} H ${trough.x} V ${trough.y}`} fill="none"
                            strokeDasharray="4 3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
                          {[peak, trough].map(({ x, y }) => (
                            <circle key={x} cx={x} cy={y} r="4" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          ))}
                        </g>
                      )}

                      {/* Data Points */}
                      {equityPoints.coords.map((pt, i) => (
                        <circle
                          key={pt.item.day}
                          cx={pt.x}
                          cy={pt.y}
                          r={pointIndex === i ? 5 : dayPoints.length < 20 ? 3 : 2}
                          className={`transition-all duration-150 ${
                            pointIndex === i
                              ? "fill-primary stroke-background stroke-2"
                              : "fill-primary/80 hover:fill-primary"
                          }`}
                        />
                      ))}

                      {/* Active Vertical Crosshair */}
                      {activeEquity && (
                        <line
                          x1={activeEquity.x}
                          y1={padTop}
                          x2={activeEquity.x}
                          y2={H - padBottom}
                          stroke="var(--accent-text)"
                          strokeWidth="1"
                          strokeDasharray="3 3"
                          className="pointer-events-none"
                        />
                      )}
                    </>
                  )}

                  {/* Invisible Touch / Hover Interaction Strips */}
                  {mode === "equity" &&
                    equityPoints.coords.map((pt, i, points) => {
                      const left = i === 0 ? padLeft : (points[i - 1].x + pt.x) / 2;
                      const right = i === points.length - 1 ? W - padRight : (pt.x + points[i + 1].x) / 2;
                      return (
                        <rect
                          key={`hit-${pt.item.day}`}
                          x={left}
                          y={padTop}
                          width={right - left}
                          height={chartH}
                          fill="transparent"
                          className="cursor-pointer"
                          onPointerMove={(event) => {
                            if (event.pointerType === "mouse" && (activeIdx !== i || touchInspection)) setActiveIdx(i);
                          }}
                          onClick={() => {
                            // WebKit can report a touch-generated click as a mouse event.
                            if (mouseClick.current) selectPoint(i);
                            mouseClick.current = false;
                          }}
                        />
                      );
                    })}

                  {mode !== "equity" &&
                    barData.map((bar, i) => {
                      const slotW = chartW / barData.length;
                      return (
                        <rect
                          key={`hit-${i}`}
                          x={padLeft + i * slotW}
                          y={padTop}
                          width={slotW}
                          height={chartH}
                          fill="transparent"
                          className="cursor-pointer"
                          onPointerEnter={(event) => {
                            if (event.pointerType === "mouse") setActiveIdx(i);
                          }}
                        />
                      );
                    })}

                </svg>
                {mode !== "equity" && activeBar && !touchInspection && (
                  <div
                    className="pointer-events-none absolute z-10 w-44 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg pointer-coarse:hidden"
                    style={{
                      left: `clamp(5.5rem, ${(activeBar.centerX / W) * 100}%, calc(100% - 5.5rem))`,
                      ...(activeBar.tipY < H / 2
                        ? { top: `calc(${(activeBar.tipY / H) * 100}% + .5rem)` }
                        : { bottom: `calc(${(1 - activeBar.tipY / H) * 100}% + .5rem)` }),
                    }}
                  >
                    <p className="font-semibold">
                      {barDate(activeBar)}
                    </p>
                    <div className="mt-1 flex justify-between gap-3 muted">
                      <span>P&amp;L</span>
                      <strong className={`tabular-nums ${activeBar.isGain ? "text-[var(--gain-text)]" : "text-[var(--loss-text)]"}`}>
                        {signedUsd(BigInt(activeBar.item.pnlCents))}
                      </strong>
                    </div>
                    <p className="muted">
                      {activeBar.item.trades} trade{activeBar.item.trades === 1 ? "" : "s"} ({activeBar.item.wins} win)
                    </p>
                  </div>
                )}
                {equityTooltip && (
                  <div
                    aria-hidden="true"
                    data-cumulative-tooltip
                    className="pointer-events-none absolute z-10 w-44 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg"
                    style={{
                      left: `clamp(5.5rem, ${(equityTooltip.x / W) * 100}%, calc(100% - 5.5rem))`,
                      ...(equityTooltip.y < H / 2
                        ? { top: `calc(${(equityTooltip.y / H) * 100}% + .5rem)` }
                        : { bottom: `calc(${(1 - equityTooltip.y / H) * 100}% + .5rem)` }),
                    }}
                  >
                    <p className="mb-1 font-semibold">{equityDate}</p>
                    <dl className="grid grid-cols-[1fr_auto] gap-1 tabular-nums">
                      <dt className="muted">Day P&amp;L</dt><dd className="text-right">{equityDaily}</dd>
                      <dt className="muted">Cumulative</dt><dd className="text-right font-semibold">{equityCumulative}</dd>
                    </dl>
                  </div>
                )}
              </div>
              <div className="mt-1 flex justify-between px-1 text-xs muted" aria-hidden="true">
                <span>{firstLabel}</span>
                {lastLabel !== firstLabel && <span>{lastLabel}</span>}
              </div>
            </div>
          </div>
        </div>
        <div id={`${chartId}-drawdown`} aria-live="polite">
          {drawdown && (
            <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs tabular-nums">
              <span className="font-semibold text-[var(--loss-text)]">{maxDD}</span>
              <span className="muted">Peak {drawdown.peakDay ? shortDate(drawdown.peakDay) : "at start of period"} → Trough {shortDate(drawdown.troughDay)}</span>
            </p>
          )}
        </div>

        {/* Deep Dive Trading Metrics Grid */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" role="list" aria-label="Advanced trading ratios">
          <div className="rounded-xl border border-border/70 bg-card/60 p-3" role="listitem">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Profit Factor</span>
              {pfBadge && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {pfBadge}
                </span>
              )}
            </div>
            <div className={`mt-1.5 text-lg font-bold tabular-nums sm:text-xl ${pfTone}`}>{pfLabel}</div>
            <div className="mt-1 text-[11px] text-muted-foreground truncate" title="Total gross profit / Total gross loss">
              Gross Win / Gross Loss
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/60 p-3" role="listitem">
            <span className="text-xs text-muted-foreground">Win / Loss Ratio</span>
            <div className="mt-1.5 text-lg font-bold tabular-nums text-foreground sm:text-xl">{prLabel}</div>
            <div className="mt-1 text-[11px] text-muted-foreground truncate" title="Average winning trade / Average losing trade">
              Payoff ratio per trade
            </div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/60 p-3" role="listitem">
            <span className="text-xs text-muted-foreground">Avg Win vs Avg Loss</span>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-1 text-sm font-semibold tabular-nums sm:text-base">
              <span className="text-emerald-400">{avgWin}</span>
              <span className="text-muted-foreground font-normal">/</span>
              <span className="text-rose-400">{avgLoss}</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">Per closed contract</div>
          </div>

          <div className="rounded-xl border border-border/70 bg-card/60" role="listitem">
            {canShowDrawdown ? (
              <button type="button" aria-label="Highlight Max Drawdown on chart" aria-pressed={showDrawdown}
                aria-controls={`${chartId}-drawdown`} onClick={() => setShowDrawdown((shown) => !shown)}
                className="flex h-full w-full cursor-pointer flex-col items-start rounded-xl p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-muted">
                <span className="block text-xs text-muted-foreground">Max Drawdown</span>
                <span className="mt-1.5 block text-lg font-bold tabular-nums text-[var(--loss-text)] sm:text-xl">{maxDD}</span>
                <span className="mt-1 block text-[11px] text-foreground underline underline-offset-2">{showDrawdown ? "Hide on chart" : "Show on chart"}</span>
              </button>
            ) : (
              <div className="p-3">
                <span className="text-xs text-muted-foreground">Max Drawdown</span>
                <div className="mt-1.5 text-lg font-bold tabular-nums text-[var(--loss-text)] sm:text-xl">{maxDD}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">Peak-to-trough decline</div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
  );
}
