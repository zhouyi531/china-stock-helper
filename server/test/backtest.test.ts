import { test } from "node:test";
import assert from "node:assert/strict";
import { runBacktest, runBacktestWithSweep } from "../src/backtest/engine.js";
import type { DailyBar } from "../src/providers/index.js";

function bar(i: number, open: number, close: number, volume = 100000): DailyBar {
  return {
    date: `2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    open,
    close,
    high: Math.max(open, close) * 1.012,
    low: Math.min(open, close) * 0.988,
    volume,
  };
}

/** Flat base -> strong rally with volume -> crash. Classic trail-stop test. */
function rallyCrash(): DailyBar[] {
  const bars: DailyBar[] = [];
  let p = 10;
  for (let i = 0; i < 40; i++) {
    const close = 10 + Math.sin(i / 3) * 0.05; // flat chop
    bars.push(bar(i, p, close));
    p = close;
  }
  for (let i = 40; i < 70; i++) {
    const close = p * 1.025; // rally
    bars.push(bar(i, p, close, 200000)); // volume-confirmed
    p = close;
  }
  for (let i = 70; i < 90; i++) {
    const close = p * 0.96; // crash
    bars.push(bar(i, p, close));
    p = close;
  }
  return bars;
}

test("rally-crash: strategy enters in the rally and the trail protects gains", () => {
  const bars = rallyCrash();
  const { metrics, trades } = runBacktest("test", bars, "breakout", 0.04, 0.05, true);
  assert.ok(trades.length >= 1, "should have at least one trade");
  const t = trades[0];
  assert.ok(t.pnlPct > 5, `breakout trade should capture the rally, got ${t.pnlPct}%`);
  assert.ok(
    t.exitReason === "trail" || t.exitReason === "hard_stop" || t.exitReason === "signal",
    `should exit on a protective rule, got ${t.exitReason}`
  );
  // the crash bottoms ~35% below the peak; a 4% trail must exit far above the bottom
  const crashBottom = bars[bars.length - 1].close;
  assert.ok(t.exitPrice > crashBottom * 1.1, "trail exit must beat riding the crash down");
  assert.ok(metrics.totalReturnPct > 0);
});

test("too-tight trail churns: more trades, worse capture per trade", () => {
  const bars = rallyCrash();
  const tight = runBacktest("t", bars, "ma", 0.005, 0.05, true);
  const sane = runBacktest("t", bars, "ma", 0.04, 0.05, true);
  if (tight.metrics.trades > 0 && sane.metrics.trades > 0) {
    const tightAvg =
      tight.trades.reduce((a, t) => a + t.pnlPct, 0) / Math.max(1, tight.trades.length);
    const saneAvg =
      sane.trades.reduce((a, t) => a + t.pnlPct, 0) / Math.max(1, sane.trades.length);
    assert.ok(
      saneAvg >= tightAvg,
      `a 4% trail should capture at least as much per trade as 0.5% (${saneAvg} vs ${tightAvg})`
    );
  }
});

test("hard stop limits damage on an immediate dump", () => {
  const bars: DailyBar[] = [];
  let p = 10;
  // build a fresh MA alignment
  for (let i = 0; i < 30; i++) {
    const close = 10 + Math.sin(i / 4) * 0.03;
    bars.push(bar(i, p, close));
    p = close;
  }
  for (let i = 30; i < 36; i++) {
    const close = p * 1.03;
    bars.push(bar(i, p, close, 250000));
    p = close;
  }
  // dump 25%
  for (let i = 36; i < 48; i++) {
    const close = p * 0.975;
    bars.push(bar(i, p, close));
    p = close;
  }
  const { trades } = runBacktest("t", bars, "ma", 0.04, 0.03, true);
  for (const t of trades) {
    // worst loss ≈ stop 3% + one-day gap + costs; must never ride the full dump
    assert.ok(t.pnlPct > -9, `stop must cut losses, got ${t.pnlPct}%`);
  }
});

test("insufficient data returns empty metrics, sweep returns the table", () => {
  const none = runBacktest("t", [], "ma", 0.03, 0.03, true);
  assert.equal(none.metrics.trades, 0);

  const res = runBacktestWithSweep("t", rallyCrash(), "breakout", 0.03, 0.03, true);
  assert.ok(res.sweep != null && res.sweep.length >= 8);
  assert.ok(res.sweep!.some((s) => s.trailPct === 0.005) && res.sweep!.some((s) => s.trailPct === 0.08));
});
