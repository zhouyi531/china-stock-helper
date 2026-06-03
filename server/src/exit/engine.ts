import type { ExitState, ExitStateKind } from "../types.js";
import { round } from "../util/math.js";

export interface ExitConfig {
  trailPct: number; // e.g. 0.0015 (0.15%)
  stopLossPct: number; // e.g. 0.03 (3%)
}

export interface ExitMemory {
  kind: ExitStateKind;
  peak: number;
}

/**
 * Advance the exit state machine by one tick. Faithful to docs/离场条件.md:
 *
 *  - watching: track peak; a drawdown of >= trailPct from peak raises a
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

  const trailTargetOf = (pk: number) => round(pk * (1 - cfg.trailPct), 3);
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

  // derive display fields for the resolved state
  switch (kind) {
    case "watching":
      targetPrice = trailTargetOf(peak);
      break;
    case "take_profit_warn":
      targetPrice = trailTargetOf(peak);
      message = `止盈离场警告：自高点 ${round(peak, 3)} 回撤≥${(cfg.trailPct * 100).toFixed(2)}%，建议目标价≈${targetPrice}`;
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
    message,
    updatedAt: Date.now(),
  };
}
