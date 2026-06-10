import type { ExitState, ExitStateKind } from "../types.js";
import { clamp, round } from "../util/math.js";

export interface ExitConfig {
  /**
   * Base trailing drawdown (fraction). In "atr" mode this is the ATR-derived
   * base and the engine tightens it as profit accrues; in "fixed" mode it is
   * used exactly as given (user override / env pin).
   */
  trailPct: number;
  /** hard stop from entry (fraction), e.g. 0.03 = −3% */
  stopLossPct: number;
  trailMode: "fixed" | "atr";
}

export interface ExitMemory {
  kind: ExitStateKind;
  peak: number;
}

/**
 * ATR-adaptive base trail: ~0.9 × dailyATR%, bounded to 0.8%..3.5%.
 * A stock that swings 3% a day needs a ~2.7% leash; a sleepy large-cap gets
 * a tighter one. (The old fixed default of 0.15% was inside bid-ask noise and
 * fired on essentially every tick.)
 */
export function adaptiveTrailBase(atrPct: number | null): number {
  if (atrPct == null || atrPct <= 0) return 0.015;
  return round(clamp(0.9 * (atrPct / 100), 0.008, 0.035), 4);
}

/**
 * Profit-tier ratchet (only in "atr" mode): the more profit the position has
 * seen at its peak, the tighter the leash — protect what you've earned.
 *   peak P/L ≥ +10% → 0.55×   ≥ +6% → 0.7×   ≥ +3% → 0.85×
 */
function tieredTrail(base: number, entry: number, peak: number, mode: "fixed" | "atr"): number {
  if (mode === "fixed" || entry <= 0) return base;
  const peakPnl = (peak - entry) / entry;
  let mult = 1;
  if (peakPnl >= 0.1) mult = 0.55;
  else if (peakPnl >= 0.06) mult = 0.7;
  else if (peakPnl >= 0.03) mult = 0.85;
  return round(Math.max(base * mult, 0.005), 4);
}

/**
 * Advance the exit state machine by one tick (semantics per docs/离场条件.md):
 *
 *  - watching: track peak; a drawdown of >= trail from peak raises a
 *    take-profit warning (target = peak*(1-trail)). If price falls below the
 *    entry price we drop into stop-loss monitoring instead.
 *  - take_profit_warn: clears once price climbs back above the target (resume
 *    watching, updating peak if a new high is made); if instead price breaks
 *    below entry, the warning clears and stop-loss monitoring begins.
 *  - stop_loss_watch: below cost, watching for the -stopLossPct line; recovering
 *    above entry resumes watching.
 *  - stop_loss_warn: loss >= stopLossPct -> sticky stop-loss warning until the
 *    user exits or price recovers above entry.
 *  - exited: frozen (user clicked 已离场 -> position cleared, no state here).
 */
export function stepExit(
  prev: ExitMemory | null,
  entry: number,
  price: number,
  cfg: ExitConfig
): ExitState {
  const stopLossPrice = round(entry * (1 - cfg.stopLossPct), 3);
  const pnlPct = entry > 0 ? round(((price - entry) / entry) * 100, 2) : 0;

  // initialise on first observation
  let kind: ExitStateKind = prev?.kind ?? "watching";
  let peak = prev?.peak ?? Math.max(entry, price);
  if (kind === "none") kind = "watching";

  const trailOf = (pk: number) => tieredTrail(cfg.trailPct, entry, pk, cfg.trailMode);
  const trailTargetOf = (pk: number) => round(pk * (1 - trailOf(pk)), 3);
  let targetPrice: number | null = null;
  let message: string | null = null;

  switch (kind) {
    case "watching": {
      if (price > peak) peak = price;
      const target = trailTargetOf(peak);
      if (price < entry) {
        kind = "stop_loss_watch";
      } else if (price <= target) {
        kind = "take_profit_warn";
      }
      break;
    }
    case "take_profit_warn": {
      const target = trailTargetOf(peak);
      if (price > target) {
        if (price > peak) peak = price;
        kind = "watching";
      } else if (price < entry) {
        kind = "stop_loss_watch";
      }
      break;
    }
    case "stop_loss_watch": {
      if (price <= stopLossPrice) {
        kind = "stop_loss_warn";
      } else if (price > entry) {
        peak = Math.max(peak, price);
        kind = "watching";
      }
      break;
    }
    case "stop_loss_warn": {
      if (price > entry) {
        peak = Math.max(peak, price);
        kind = "watching";
      }
      break;
    }
    case "exited":
      break;
  }

  const effTrail = trailOf(peak);

  // derive display fields for the resolved state
  switch (kind) {
    case "watching":
      targetPrice = trailTargetOf(peak);
      break;
    case "take_profit_warn":
      targetPrice = trailTargetOf(peak);
      message = `止盈离场警告：自高点 ${round(peak, 3)} 回撤≥${(effTrail * 100).toFixed(2)}%${cfg.trailMode === "atr" ? "（ATR自适应）" : ""}，建议目标价≈${targetPrice}`;
      break;
    case "stop_loss_watch":
      message = `已跌破成本价，监控止损线 ${stopLossPrice}`;
      break;
    case "stop_loss_warn":
      message = `止损离场警告：亏损已达 ${pnlPct}%（止损线 ${stopLossPrice}）`;
      break;
    case "exited":
      break;
  }

  return {
    symbol: "",
    kind,
    entryPrice: entry,
    peak: round(peak, 3),
    targetPrice,
    stopLossPrice,
    pnlPct,
    trailPct: effTrail,
    stopLossPct: cfg.stopLossPct,
    trailMode: cfg.trailMode,
    acknowledged: false, // filled by the realtime loop from persisted state
    message,
    updatedAt: Date.now(),
  };
}
