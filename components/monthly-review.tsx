"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ExecutionTable } from "@/components/execution-table";
import { PerformanceVisualizer } from "@/components/performance-visualizer";
import { summarizePerformance, type PerformanceData } from "@/lib/performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isJournalMonth, shiftJournalMonth } from "@/lib/journal-month";
import type { MonthlyTrades } from "@/lib/monthly-trades";
import { holdingDuration } from "@/lib/trade-executions";
import { cents, signedUsd, formatThbEstimate } from "@/lib/summary-csv";

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const fullDayFormat = new Intl.DateTimeFormat("en-GB", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" });

const compactCalendarUsd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", signDisplay: "auto", maximumFractionDigits: 1,
});

function formatCalendarUsd(amount: bigint): string {
  const magnitude = amount < 0n ? -amount : amount;
  const prefix = amount < 0n ? "−" : "";
  return `${prefix}$${(magnitude / 100n).toLocaleString("en-US")}.${(magnitude % 100n).toString().padStart(2, "0")}`;
}
const emptyTrades: MonthlyTrades = [];
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function calendarAmount(value: string) {
  return { "--amount-characters": value.length } as CSSProperties;
}

function formatReturn(buyPriceStr: string | null, sellPriceStr: string | null): string | null {
  if (!buyPriceStr || !sellPriceStr) return null;
  const buy = parseFloat(buyPriceStr);
  const sell = parseFloat(sellPriceStr);
  if (isNaN(buy) || isNaN(sell) || buy <= 0) return null;
  const pct = ((sell - buy) / buy) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export function MonthlyReview({ account, initialMonth, initialDay, initialTrades, timeZone, allTimePerformance }: {
  account: string;
  initialMonth: string;
  initialDay?: string;
  initialTrades: MonthlyTrades | null;
  timeZone: string;
  allTimePerformance: PerformanceData | null;
}) {
  const [{ month: selectedMonth, day }, setSelection] = useState({ month: initialMonth, day: initialDay });
  const [expandedTradeId, setExpandedTradeId] = useState<string | null>(null);
  const [slideDir, setSlideDir] = useState<"left" | "right" | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const previous = shiftJournalMonth(selectedMonth, -1);
  const next = shiftJournalMonth(selectedMonth, 1);

  const goToMonth = useCallback((targetMonth: string, dir: "left" | "right") => {
    setSlideDir(dir);
    setSelection({ month: targetMonth, day: undefined });
    setExpandedTradeId(null);
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absX >= 40 && absX > absY * 1.2 && elapsed < 600) {
      if (deltaX < 0 && isJournalMonth(next)) {
        goToMonth(next, "left");
      } else if (deltaX > 0 && isJournalMonth(previous)) {
        goToMonth(previous, "right");
      }
    }
  };
  const start = new Date(`${selectedMonth}-01T00:00:00Z`);
  const end = new Date(`${next}-01T00:00:00Z`);

  const requests = useMemo(() => new Map<string, Promise<MonthlyTrades>>(), [account, initialMonth, initialTrades]);
  const [months, setMonths] = useState<Map<string, MonthlyTrades | null>>(() => {
    const initial = new Map<string, MonthlyTrades | null>();
    if (initialTrades) initial.set(initialMonth, initialTrades);
    return initial;
  });

  const trades = months.get(selectedMonth);
  const saveMonth = useCallback((monthKey: string, data: MonthlyTrades | null) => {
    setMonths((current) => {
      const next = new Map(current);
      next.set(monthKey, data);
      return next;
    });
  }, []);

  const loadMonth = useCallback((monthKey: string) => {
    const existing = requests.get(monthKey);
    if (existing) return existing;
    const request = fetch(`/api/monthly-trades?account=${encodeURIComponent(account)}&month=${monthKey}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load monthly trades.");
        const data = (await response.json()) as MonthlyTrades;
        saveMonth(monthKey, data);
        return data;
      })
      .catch((error: unknown) => {
        requests.delete(monthKey);
        throw error;
      });
    requests.set(monthKey, request);
    return request;
  }, [account, requests, saveMonth]);

  const monthReady = trades !== undefined;

  useEffect(() => {
    if (monthReady) {
      for (const neighbor of [previous, next]) {
        if (isJournalMonth(neighbor)) void loadMonth(neighbor).catch(() => {});
      }
      return;
    }

    let active = true;
    void loadMonth(selectedMonth).catch(() => {
      if (active) saveMonth(selectedMonth, null);
    });
    return () => { active = false; };
  }, [loadMonth, monthReady, next, previous, selectedMonth, saveMonth]);

  const loading = trades === undefined;
  const error = trades === null;
  const monthTrades = trades ?? emptyTrades;
  const monthPerformance = useMemo(() => trades == null ? trades : summarizePerformance(
    trades.map((trade) => ({ day: trade.sessionDate, gross: trade.gross })),
  ), [trades]);

  const { days, gross, wins, hasWeekendTrades } = useMemo(() => {
    const days = new Map<string, { gross: bigint; trades: MonthlyTrades }>();
    let gross = 0n;
    let wins = 0;
    let hasWeekendTrades = false;
    for (const trade of monthTrades) {
      const amount = cents(trade.gross);
      gross += amount;
      if (amount > 0n) wins++;
      const weekday = new Date(`${trade.sessionDate}T00:00:00Z`).getUTCDay();
      if (weekday === 0 || weekday === 6) hasWeekendTrades = true;
      const result = days.get(trade.sessionDate) ?? { gross: 0n, trades: [] };
      result.gross += amount;
      result.trades.push(trade);
      days.set(trade.sessionDate, result);
    }
    return { days, gross, wins, hasWeekendTrades };
  }, [monthTrades]);

  const weekdayLabels = hasWeekendTrades ? [...weekdays, "Sat", "Sun"] : weekdays;
  const cells: (Date | null)[] = [];
  const firstMonday = new Date(start);
  firstMonday.setUTCDate(1 - (start.getUTCDay() + 6) % 7);
  for (const date = firstMonday; date < end; date.setUTCDate(date.getUTCDate() + 1)) {
    if (hasWeekendTrades || (date.getUTCDay() >= 1 && date.getUTCDay() <= 5)) {
      cells.push(date < start ? null : new Date(date));
    }
  }
  while (cells.length % weekdayLabels.length) cells.push(null);
  const visibleDays = cells.flatMap((date) => date ? [date.toISOString().slice(0, 10)] : []);
  const selectedDay = day && visibleDays.includes(day) ? day
    : visibleDays.findLast((key) => days.has(key)) ?? visibleDays[0];
  const daily = days.get(selectedDay);

  const ranked = (daily?.trades ?? []).map((trade) => ({ trade, gross: cents(trade.gross) }))
    .sort((a, b) => a.gross > b.gross ? -1 : a.gross < b.gross ? 1 : 0);
  const best = ranked.find((item) => item.gross > 0n);
  const worst = ranked.findLast((item) => item.gross < 0n);
  const contract = (trade: MonthlyTrades[number]) => `${trade.symbol} ${trade.strike} ${trade.option_type}`;
  const dailyTrades = daily?.trades ?? [];
  const dailyWins = dailyTrades.filter((trade) => cents(trade.gross) > 0n).length;
  const dailyWinRate = dailyTrades.length ? `${(dailyWins / dailyTrades.length * 100).toFixed(1)}%` : "—";

  return (
    <div className="mb-6 grid gap-4">
      {/* ─── Monthly Heatmap Card ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-2">
            <div className="w-full text-center sm:w-auto sm:text-left">
              <CardTitle>Monthly Gross P&amp;L</CardTitle>
            </div>
            <nav className="flex items-center justify-center gap-2 w-full sm:w-auto" aria-label="Choose month">
              <button type="button" className="calendar-arrow" disabled={!isJournalMonth(previous)}
                onClick={() => goToMonth(previous, "right")} aria-label="Previous month">‹</button>
              <strong className="min-w-28 text-center text-sm font-semibold" aria-live="polite">{monthFormat.format(start)}</strong>
              <button type="button" className="calendar-arrow" disabled={!isJournalMonth(next)}
                onClick={() => goToMonth(next, "left")} aria-label="Next month">›</button>
            </nav>
          </div>
        </CardHeader>
        <CardContent className="px-2 sm:px-5">
          {error ? (
            <div className="flex flex-wrap items-center gap-3">
              <p role="alert">Monthly trades could not be loaded.</p>
              <button type="button" className="button secondary" onClick={() => {
                void loadMonth(selectedMonth).catch(() => saveMonth(selectedMonth, null));
              }}>Retry</button>
            </div>
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 text-sm" aria-label="Monthly summary" aria-busy={loading}>
                <div className="col-span-2 sm:col-span-1 min-w-0 rounded-lg border border-border p-2 sm:p-3">
                  <dt className="muted">Gross P&amp;L</dt>
                  <dd className="dashboard-amount mt-1 font-semibold">
                    {loading ? (
                      <span className="inline-block h-5 w-16 animate-pulse rounded bg-muted/60" aria-hidden="true" />
                    ) : (
                      <>
                        <div className={`text-2xl sm:text-3xl font-bold tracking-tight font-mono ${
                          monthTrades.length && gross > 0n
                            ? "text-emerald-500 dark:text-emerald-400"
                            : monthTrades.length && gross < 0n
                            ? "text-rose-500 dark:text-rose-400"
                            : "text-foreground"
                        }`}>
                          {monthTrades.length ? signedUsd(gross) : "—"}
                        </div>
                        {monthTrades.length > 0 && (
                          <div className={`text-xs sm:text-sm font-mono font-normal mt-0.5 ${
                            gross > 0n
                              ? "text-emerald-600/80 dark:text-emerald-400/80"
                              : gross < 0n
                              ? "text-rose-600/80 dark:text-rose-400/80"
                              : "text-muted-foreground"
                          }`}>
                            {formatThbEstimate(gross)}
                          </div>
                        )}
                      </>
                    )}
                  </dd>
                </div>
                <div className="col-span-1 min-w-0 rounded-lg border border-border p-2 sm:p-3">
                  <dt className="muted">Closed trades</dt>
                  <dd className="dashboard-amount mt-1 text-xl sm:text-2xl font-bold tracking-tight font-mono">
                    {loading ? (
                      <span className="inline-block h-6 w-12 animate-pulse rounded bg-muted/60" aria-hidden="true" />
                    ) : (
                      String(monthTrades.length)
                    )}
                  </dd>
                </div>
                <div className="col-span-1 min-w-0 rounded-lg border border-border p-2 sm:p-3">
                  <dt className="muted">Win rate</dt>
                  <dd className="dashboard-amount mt-1 text-xl sm:text-2xl font-bold tracking-tight font-mono">
                    {loading ? (
                      <span className="inline-block h-6 w-12 animate-pulse rounded bg-muted/60" aria-hidden="true" />
                    ) : (
                      monthTrades.length ? `${(wins / monthTrades.length * 100).toFixed(1)}%` : "—"
                    )}
                  </dd>
                </div>
              </dl>

              <div
                className="touch-pan-y select-none overflow-hidden p-1 -m-1"
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div
                  key={selectedMonth}
                  className={`trade-calendar ${
                    slideDir === "left"
                      ? "heatmap-slide-right"
                      : slideDir === "right"
                      ? "heatmap-slide-left"
                      : ""
                  }`}
                  data-weekends={hasWeekendTrades || undefined}
                  aria-busy={loading}
                  onAnimationEnd={() => setSlideDir(null)}
                >
                  {weekdayLabels.map((weekday) => (
                    <div key={weekday} className="muted pb-1 text-center text-xs font-semibold uppercase tracking-wider">{weekday}</div>
                  ))}
                  {cells.map((date, index) => {
                    if (!date) return <div key={index} aria-hidden="true" />;
                    const key = date.toISOString().slice(0, 10);
                    const result = days.get(key);
                    const tone = result?.gross && result.gross > 0n ? "gain" : result?.gross && result.gross < 0n ? "loss" : "flat";
                    const value = result ? formatCalendarUsd(result.gross) : "—";
                    const compact = result && (result.gross >= 100000n || result.gross <= -100000n)
                      ? compactCalendarUsd.format(Number(result.gross) / 100).replace("-", "−") : null;
                    const isSelected = selectedDay === key;

                    return (
                      <button
                        key={key}
                        type="button"
                        className="trade-day"
                        data-tone={tone}
                        data-selected={isSelected || undefined}
                        onClick={() => {
                          setSelection({ month: selectedMonth, day: key });
                          setExpandedTradeId(null); // Reset accordion to first item
                        }}
                        aria-controls="daily-trades"
                        aria-current={isSelected ? "date" : undefined}
                        aria-label={`${dayFormat.format(date)}${loading ? "" : `, ${result ? value : "no trades"}`}`}
                        title={result ? value : undefined}
                      >
                        <span className="flex items-center justify-between w-full">
                          <span className="text-xs font-semibold">
                            {date.getUTCDate()}
                          </span>
                          {result && result.trades.length > 0 && (
                            <span className="text-[10px] opacity-75 font-mono">{result.trades.length}T</span>
                          )}
                        </span>
                        {loading ? (
                          <span className="my-0.5 inline-block h-3.5 w-10 animate-pulse rounded bg-muted/50" aria-hidden="true" />
                        ) : (
                          <strong>
                            <span className={compact ? "calendar-amount-full" : undefined} style={calendarAmount(value)}>{value}</span>
                            {compact && <span className="calendar-amount-compact" style={calendarAmount(compact)}>{compact}</span>}
                          </strong>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ─── Daily Trades Detail Section (Clean & Minimal Version) ────────── */}
      <PerformanceVisualizer
        month={selectedMonth}
        monthData={monthPerformance}
        allTimeData={allTimePerformance}
        selectedDay={selectedDay}
        onSelectDay={(chosenDay) => {
          setSelection({ month: chosenDay.slice(0, 7), day: chosenDay });
          setExpandedTradeId(null);
        }}
      />

      {!error && (
        <Card id="daily-trades" className="overflow-hidden border border-border" aria-labelledby="daily-review-title">
          <CardHeader className="pb-2 pt-5 px-5 sm:px-6">
            <h2 id="daily-review-title" className="text-xl sm:text-2xl font-bold tracking-tight text-foreground" aria-live="polite">
              {selectedDay ? fullDayFormat.format(new Date(`${selectedDay}T00:00:00Z`)) : "Select a day"}
            </h2>
          </CardHeader>

          <CardContent className="px-5 sm:px-6 pb-6">
            {loading ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 py-4" aria-busy="true">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="rounded-xl border border-border/60 p-4 animate-pulse">
                    <div className="h-3 w-16 bg-muted/60 rounded" />
                    <div className="mt-2.5 h-6 w-24 bg-muted/80 rounded" />
                  </div>
                ))}
              </div>
            ) : daily && daily.trades.length > 0 ? (
              <>
                {/* Clean Daily Summary Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-y-5 gap-x-6 sm:gap-x-8 pt-2 pb-5">
                  <div className="col-span-2 sm:col-span-1">
                    <div className="text-xs sm:text-sm text-muted-foreground">Gross P&amp;L</div>
                    <div className={`text-2xl sm:text-3xl font-bold tracking-tight mt-1 font-mono ${
                      daily.gross > 0n
                        ? "text-emerald-500 dark:text-emerald-400"
                        : daily.gross < 0n
                        ? "text-rose-500 dark:text-rose-400"
                        : "text-foreground"
                    }`}>
                      {signedUsd(daily.gross)}
                    </div>
                    <div className={`text-xs sm:text-sm font-mono mt-0.5 ${
                      daily.gross > 0n
                        ? "text-emerald-600/80 dark:text-emerald-400/80"
                        : daily.gross < 0n
                        ? "text-rose-600/80 dark:text-rose-400/80"
                        : "text-muted-foreground"
                    }`}>
                      {formatThbEstimate(daily.gross)}
                    </div>
                  </div>
                  <div className="col-span-1">
                    <div className="text-xs sm:text-sm text-muted-foreground">Closed trades</div>
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mt-1 font-mono">
                      {daily.trades.length}
                    </div>
                  </div>
                  <div className="col-span-1">
                    <div className="text-xs sm:text-sm text-muted-foreground">Win rate</div>
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mt-1 font-mono">
                      {dailyWinRate}
                    </div>
                  </div>
                  <div className="col-span-1">
                    <div className="text-xs sm:text-sm text-muted-foreground">Biggest gain</div>
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-500 dark:text-emerald-400 mt-1 font-mono">
                      {best ? signedUsd(best.gross) : "—"}
                    </div>
                    {best && <div className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">{contract(best.trade)}</div>}
                  </div>
                  <div className="col-span-1">
                    <div className="text-xs sm:text-sm text-muted-foreground">Biggest loss</div>
                    <div className="text-xl sm:text-2xl font-bold tracking-tight text-rose-500 dark:text-rose-400 mt-1 font-mono">
                      {worst ? signedUsd(worst.gross) : "—"}
                    </div>
                    {worst && <div className="text-xs sm:text-sm text-muted-foreground mt-0.5 truncate">{contract(worst.trade)}</div>}
                  </div>
                </div>

                {/* Section Header */}
                <div className="mt-3 mb-3">
                  <h3 className="text-base sm:text-lg font-semibold text-foreground">Closed trades</h3>
                </div>

                {/* Accordion List of Trades */}
                <div className="space-y-3" role="list" aria-label="Closed trades list">
                  {daily.trades.map((trade, idx) => {
                    const isExpanded = expandedTradeId === trade.id || (expandedTradeId === null && idx === 0);
                    const tradeGrossCents = cents(trade.gross);
                    const isGain = tradeGrossCents > 0n;
                    const durationStr = holdingDuration(trade.executions);
                    const returnPct = formatReturn(trade.buy_price, trade.sell_price);

                    return (
                      <div
                        key={trade.id}
                        role="listitem"
                        className={`rounded-xl border transition-colors ${
                          isExpanded
                            ? "border-border bg-card shadow-xs"
                            : "border-border/70 hover:border-border bg-card/40"
                        }`}
                      >
                        {/* Header Row (Click to toggle) */}
                        <button
                          type="button"
                          onClick={() => setExpandedTradeId(isExpanded ? "" : trade.id)}
                          className="w-full flex items-center justify-between p-4 sm:p-5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-xl"
                          aria-expanded={isExpanded}
                        >
                          <div className="min-w-0 flex-1 pr-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base sm:text-lg font-semibold text-foreground tracking-tight">
                                {trade.symbol} {trade.strike} {trade.option_type}
                              </span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-normal bg-muted/20 text-muted-foreground border border-border/60">
                                {trade.quantity} contract{trade.quantity !== 1 ? "s" : ""}
                              </span>
                            </div>
                            {(returnPct || durationStr) && (
                              <div className="text-xs sm:text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 font-normal">
                                {returnPct && (
                                  <span className={isGain ? "text-[var(--gain-text)] font-medium" : "text-[var(--loss-text)] font-medium"}>
                                    {returnPct}
                                  </span>
                                )}
                                {returnPct && durationStr && <span aria-hidden="true" className="opacity-40">·</span>}
                                {durationStr && <span title="First entry → final exit">Held {durationStr}</span>}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-base sm:text-lg font-bold font-mono tracking-tight ${
                              isGain
                                ? "text-emerald-500 dark:text-emerald-400"
                                : tradeGrossCents < 0n
                                ? "text-rose-500 dark:text-rose-400"
                                : "text-foreground"
                            }`}>
                              {signedUsd(tradeGrossCents)}
                            </span>
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className={`text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                              aria-hidden="true"
                            >
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </div>
                        </button>

                        {/* Expanded Drawer Details */}
                        {isExpanded && (
                          <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-1 border-t border-border/40 animate-in fade-in duration-100">
                            <div className="mt-3">
                              <h4 className="text-xs sm:text-sm font-semibold text-foreground mb-2">Transactions</h4>
                              <ExecutionTable executions={trade.executions} />
                            </div>

                            {trade.image_id && (
                              <div className="mt-3 pt-2.5 border-t border-border/30 flex justify-end">
                                <Link
                                  href={`/imports/dime/${trade.image_id}`}
                                  prefetch={false}
                                  className="text-xs text-link underline inline-flex items-center gap-1 font-medium"
                                >
                                  View source screenshot ↗
                                </Link>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="muted py-8 text-center text-sm">No closed trades recorded on this day.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
