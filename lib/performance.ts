import type { SupabaseClient } from "@supabase/supabase-js";
import { cents } from "./summary-csv";

export type DayPoint = {
  day: string; // YYYY-MM-DD
  pnlCents: string;
  cumulativeCents: string;
  trades: number;
  wins: number;
};

export type WeekBar = {
  weekKey: string; // YYYY-MM-DD (Monday)
  label: string; // e.g. "Oct 12"
  pnlCents: string;
  trades: number;
  wins: number;
};

export type AdvancedMetrics = {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  winRate: number;
  grossProfitCents: string;
  grossLossCents: string;
  netPnLCents: string;
  profitFactor: number | null;
  avgWinCents: string;
  avgLossCents: string;
  winLossRatio: number | null;
  maxDrawdownCents: string;
};

export type PerformanceData = {
  metrics: AdvancedMetrics;
  dayPoints: DayPoint[];
  weekBars: WeekBar[];
  maxDrawdownRange: { peakDay: string | null; troughDay: string } | null;
};

const weekLabelFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function getWeekMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff));
  return monday.toISOString().slice(0, 10);
}

export async function getPerformanceData(client: SupabaseClient, accountId: string): Promise<PerformanceData | null> {
  const pageSize = 1000;
  const query = client.rpc("journal_closed_trades", {
    target_account: accountId,
  }).select("day,gross:gross::text").order("day").order("id");

  const trades: { day: string; gross: string }[] = [];
  while (true) {
    const page = await query.range(trades.length, trades.length + pageSize - 1);
    if (page.error || !Array.isArray(page.data)) return null;
    trades.push(...page.data);
    if (page.data.length < pageSize) break;
  }
  return summarizePerformance(trades);
}

export function summarizePerformance(trades: { day: string; gross: string }[]): PerformanceData {
  let grossProfit = 0n;
  let grossLoss = 0n;
  let wins = 0;
  let losses = 0;
  let breakEvens = 0;

  const dayMap = new Map<string, { pnl: bigint; trades: number; wins: number }>();
  const weekMap = new Map<string, { pnl: bigint; trades: number; wins: number }>();

  for (const trade of trades) {
    let pnl = 0n;
    try {
      pnl = cents(trade.gross);
    } catch {
      continue;
    }

    if (pnl > 0n) {
      grossProfit += pnl;
      wins++;
    } else if (pnl < 0n) {
      grossLoss += -pnl;
      losses++;
    } else {
      breakEvens++;
    }

    // Daily aggregate
    const d = dayMap.get(trade.day) ?? { pnl: 0n, trades: 0, wins: 0 };
    d.pnl += pnl;
    d.trades++;
    if (pnl > 0n) d.wins++;
    dayMap.set(trade.day, d);

    // Weekly aggregate
    const monday = getWeekMonday(trade.day);
    const w = weekMap.get(monday) ?? { pnl: 0n, trades: 0, wins: 0 };
    w.pnl += pnl;
    w.trades++;
    if (pnl > 0n) w.wins++;
    weekMap.set(monday, w);
  }

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const netPnL = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0n ? Number(grossProfit) / Number(grossLoss) : null;
  const avgWin = wins > 0 ? grossProfit / BigInt(wins) : 0n;
  const avgLoss = losses > 0 ? grossLoss / BigInt(losses) : 0n;
  const winLossRatio = avgLoss > 0n ? Number(avgWin) / Number(avgLoss) : null;

  const sortedDays = Array.from(dayMap.keys()).sort();
  let cumulative = 0n;
  let peak = 0n;
  let peakDay: string | null = null;
  let maxDrawdown = 0n;
  let maxDrawdownRange: PerformanceData["maxDrawdownRange"] = null;

  const dayPoints: DayPoint[] = [];
  for (const day of sortedDays) {
    const d = dayMap.get(day)!;
    cumulative += d.pnl;
    if (cumulative > peak) {
      peak = cumulative;
      peakDay = day;
    } else {
      const dd = peak - cumulative;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownRange = { peakDay, troughDay: day };
      }
    }
    dayPoints.push({
      day,
      pnlCents: d.pnl.toString(),
      cumulativeCents: cumulative.toString(),
      trades: d.trades,
      wins: d.wins,
    });
  }

  const sortedWeeks = Array.from(weekMap.keys()).sort();
  const weekBars: WeekBar[] = sortedWeeks.map((weekMonday) => {
    const w = weekMap.get(weekMonday)!;
    const dateObj = new Date(`${weekMonday}T00:00:00Z`);
    return {
      weekKey: weekMonday,
      label: weekLabelFormat.format(dateObj),
      pnlCents: w.pnl.toString(),
      trades: w.trades,
      wins: w.wins,
    };
  });

  return {
    metrics: {
      totalTrades,
      winningTrades: wins,
      losingTrades: losses,
      breakEvenTrades: breakEvens,
      winRate,
      grossProfitCents: grossProfit.toString(),
      grossLossCents: (-grossLoss).toString(),
      netPnLCents: netPnL.toString(),
      profitFactor,
      avgWinCents: avgWin.toString(),
      avgLossCents: (-avgLoss).toString(),
      winLossRatio,
      maxDrawdownCents: (-maxDrawdown).toString(),
    },
    dayPoints,
    weekBars,
    maxDrawdownRange,
  };
}
