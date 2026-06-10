import type {
  BacktestMetrics,
  BacktestResult,
  BacktestStrategy,
  BacktestTrade,
  Symbol,
} from "../types.js";
import type { DailyBar } from "../providers/index.js";
import { mean, round, sma } from "../util/math.js";

/**
 * Round-trip friction: commission ~0.025%×2 + stamp duty 0.05% (sell) +
 * slippage ≈ 0.2% total. Applied once per completed trade so results reflect
 * what actually lands in the account.
 */
const COST_PCT = 0.002;

interface SimPosition {
  entryIdx: number;
  entryDate: string;
  entryPrice: number;
  peak: number;
}

function maAt(closes: number[], i: number, n: number): number | null {
  if (i + 1 < n) return null;
  return mean(closes.slice(i + 1 - n, i + 1));
}

/** Entry signal evaluated on bar i's close; enter at bar i+1 open. */
function entrySignal(
  strategy: BacktestStrategy,
  bars: DailyBar[],
  closes: number[],
  i: number
): boolean {
  if (strategy === "ma") {
    const ma5 = maAt(closes, i, 5);
    const ma10 = maAt(closes, i, 10);
    const ma20 = maAt(closes, i, 20);
    if (ma5 == null || ma10 == null || ma20 == null) return false;
    const alignedNow = closes[i] > ma5 && ma5 > ma10 && closes[i] > ma20;
    const pm5 = maAt(closes, i - 1, 5);
    const pm10 = maAt(closes, i - 1, 10);
    const alignedPrev =
      pm5 != null && pm10 != null && closes[i - 1] > pm5 && pm5 > pm10;
    return alignedNow && !alignedPrev; // fresh alignment only
  }
  // breakout: close above the previous 20 days' highest high, volume-confirmed
  if (i < 21) return false;
  const prevHigh = Math.max(...bars.slice(i - 20, i).map((b) => b.high));
  const vol20 = mean(bars.slice(i - 20, i).map((b) => b.volume));
  const fresh = bars[i - 1].close <= Math.max(...bars.slice(i - 21, i - 1).map((b) => b.high));
  return bars[i].close > prevHigh && bars[i].volume > 1.3 * vol20 && fresh;
}

/** Signal-based exit on close (in addition to stops): trend broken. */
function exitSignal(closes: number[], i: number): boolean {
  const ma10 = maAt(closes, i, 10);
  return ma10 != null && closes[i] < ma10;
}

function emptyMetrics(): BacktestMetrics {
  return {
    trades: 0,
    winRate: null,
    avgWinPct: null,
    avgLossPct: null,
    profitFactor: null,
    totalReturnPct: 0,
    maxDrawdownPct: 0,
    avgHoldDays: null,
    buyHoldReturnPct: 0,
  };
}

export function runBacktest(
  symbol: Symbol,
  bars: DailyBar[],
  strategy: BacktestStrategy,
  trailPct: number,
  stopPct: number,
  collectTrades = true
): { metrics: BacktestMetrics; trades: BacktestTrade[] } {
  const usable = bars.filter((b) => b.close > 0 && b.high > 0 && b.low > 0);
  if (usable.length < 40) return { metrics: emptyMetrics(), trades: [] };

  const closes = usable.map((b) => b.close);
  const trades: BacktestTrade[] = [];

  let pos: SimPosition | null = null;
  let equity = 1;
  let peakEquity = 1;
  let maxDD = 0;
  let pendingEntry = false;
  let pendingExit = false;

  const markEquity = (mark: number) => {
    peakEquity = Math.max(peakEquity, mark);
    maxDD = Math.max(maxDD, (peakEquity - mark) / peakEquity);
  };

  const closeTrade = (i: number, exitPrice: number, reason: BacktestTrade["exitReason"]) => {
    if (!pos) return;
    const gross = exitPrice / pos.entryPrice - 1;
    const net = gross - COST_PCT;
    equity *= 1 + net;
    markEquity(equity);
    // trades are always tracked (metrics need them); collectTrades only
    // controls whether they are returned to the caller
    trades.push({
      entryDate: pos.entryDate,
      entryPrice: round(pos.entryPrice, 3),
      exitDate: usable[i].date,
      exitPrice: round(exitPrice, 3),
      pnlPct: round(net * 100, 2),
      holdDays: i - pos.entryIdx,
      exitReason: reason,
    });
    pos = null;
    pendingExit = false;
  };

  for (let i = 1; i < usable.length; i++) {
    const bar = usable[i];

    // 1) execute pending entry at today's open
    if (pendingEntry && !pos) {
      pos = { entryIdx: i, entryDate: bar.date, entryPrice: bar.open, peak: bar.open };
      pendingEntry = false;
    }

    if (pos) {
      const hardStop = pos.entryPrice * (1 - stopPct);
      const trailTarget = pos.peak * (1 - trailPct); // peak BEFORE today

      // 2) pending signal exit fires at today's open
      if (pendingExit) {
        closeTrade(i, bar.open, "signal");
      } else if (bar.open <= hardStop) {
        closeTrade(i, bar.open, "hard_stop"); // gapped through the stop
      } else if (bar.open <= trailTarget && pos.peak > pos.entryPrice) {
        closeTrade(i, bar.open, "trail");
      } else if (bar.low <= hardStop) {
        closeTrade(i, hardStop, "hard_stop");
      } else if (bar.low <= trailTarget && pos.peak > pos.entryPrice) {
        closeTrade(i, trailTarget, "trail");
      } else {
        pos.peak = Math.max(pos.peak, bar.high);
        // mark-to-market drawdown while holding
        markEquity(equity * (bar.close / pos.entryPrice));
        if (exitSignal(closes, i)) pendingExit = true;
      }
    }

    // 3) evaluate entry signal on today's close (enter tomorrow's open)
    if (!pos && !pendingEntry && i < usable.length - 1) {
      if (entrySignal(strategy, usable, closes, i)) pendingEntry = true;
    }
  }

  // force-close at the last bar
  if (pos) {
    const lastIdx = usable.length - 1;
    closeTrade(lastIdx, usable[lastIdx].close, "eod");
  }

  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0));

  const first = usable[0];
  const last = usable[usable.length - 1];

  const metrics: BacktestMetrics = {
    trades: trades.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : null,
    avgWinPct: wins.length ? round(grossWin / wins.length, 2) : null,
    avgLossPct: losses.length ? round(-grossLoss / losses.length, 2) : null,
    profitFactor:
      grossLoss > 0 ? round(grossWin / grossLoss, 2) : trades.length && grossWin > 0 ? 99 : null,
    totalReturnPct: round((equity - 1) * 100, 2),
    maxDrawdownPct: round(maxDD * 100, 2),
    avgHoldDays: trades.length ? round(mean(trades.map((t) => t.holdDays)), 1) : null,
    buyHoldReturnPct: first.close > 0 ? round((last.close / first.close - 1) * 100, 2) : 0,
  };

  return { metrics, trades: collectTrades ? trades : [] };
}

/** Trailing-stop values worth sweeping: shows where the response curve lives. */
const SWEEP_TRAILS = [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06, 0.08];

export function runBacktestWithSweep(
  symbol: Symbol,
  bars: DailyBar[],
  strategy: BacktestStrategy,
  trailPct: number,
  stopPct: number,
  sweep: boolean
): BacktestResult {
  const main = runBacktest(symbol, bars, strategy, trailPct, stopPct, true);
  const usable = bars.filter((b) => b.close > 0);
  return {
    symbol,
    strategy,
    bars: usable.length,
    startDate: usable[0]?.date ?? null,
    endDate: usable[usable.length - 1]?.date ?? null,
    trailPct,
    stopPct,
    metrics: main.metrics,
    trades: main.trades.slice(-30), // last 30 trades is plenty for the UI
    sweep: sweep
      ? SWEEP_TRAILS.map((t) => ({
          trailPct: t,
          metrics: runBacktest(symbol, bars, strategy, t, stopPct, false).metrics,
        }))
      : null,
  };
}
