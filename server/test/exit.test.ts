import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptiveTrailBase, stepExit, type ExitConfig } from "../src/exit/engine.js";

const FIXED: ExitConfig = { trailPct: 0.02, stopLossPct: 0.03, trailMode: "fixed" };

test("adaptiveTrailBase: scales with ATR and stays bounded", () => {
  assert.equal(adaptiveTrailBase(null), 0.015); // no ATR -> sane default
  assert.equal(adaptiveTrailBase(2.0), 0.018); // 0.9 × 2%
  assert.equal(adaptiveTrailBase(0.1), 0.008); // floor
  assert.equal(adaptiveTrailBase(10), 0.035); // ceiling
});

test("watching: tracks peak, fires take-profit warn after trail drawdown", () => {
  // entry 10, runs to 11, then pulls back 2% -> warn
  let st = stepExit(null, 10, 10.5, FIXED);
  assert.equal(st.kind, "watching");
  st = stepExit({ kind: st.kind, peak: st.peak }, 10, 11, FIXED);
  assert.equal(st.peak, 11);
  const target = 11 * (1 - 0.02);
  st = stepExit({ kind: st.kind, peak: st.peak }, 10, target - 0.01, FIXED);
  assert.equal(st.kind, "take_profit_warn");
  assert.ok(st.message?.includes("止盈"));
});

test("take-profit warn clears on recovery; falls to stop-loss watch below entry", () => {
  let st = stepExit({ kind: "take_profit_warn", peak: 11 }, 10, 11.1, FIXED);
  assert.equal(st.kind, "watching");
  assert.equal(st.peak, 11.1);

  st = stepExit({ kind: "take_profit_warn", peak: 11 }, 10, 9.9, FIXED);
  assert.equal(st.kind, "stop_loss_watch");
});

test("stop-loss path: watch below entry, warn at -3%, recover above entry", () => {
  let st = stepExit(null, 10, 9.95, FIXED);
  assert.equal(st.kind, "stop_loss_watch");

  st = stepExit({ kind: st.kind, peak: 10 }, 10, 9.7, FIXED);
  assert.equal(st.kind, "stop_loss_warn");
  assert.equal(st.stopLossPrice, 9.7);

  st = stepExit({ kind: st.kind, peak: 10 }, 10, 10.05, FIXED);
  assert.equal(st.kind, "watching");
});

test("ATR mode: trail tightens as peak profit grows (ratchet)", () => {
  const cfg: ExitConfig = { trailPct: 0.03, stopLossPct: 0.03, trailMode: "atr" };
  // peak pnl < 3%: full base trail
  let st = stepExit({ kind: "watching", peak: 10.2 }, 10, 10.2, cfg);
  assert.equal(st.trailPct, 0.03);
  // peak pnl 5% -> 0.85×
  st = stepExit({ kind: "watching", peak: 10.5 }, 10, 10.5, cfg);
  assert.equal(st.trailPct, 0.0255);
  // peak pnl 8% -> 0.7×
  st = stepExit({ kind: "watching", peak: 10.8 }, 10, 10.8, cfg);
  assert.equal(st.trailPct, 0.021);
  // peak pnl 12% -> 0.55×
  st = stepExit({ kind: "watching", peak: 11.2 }, 10, 11.2, cfg);
  assert.equal(st.trailPct, 0.0165);
});

test("fixed mode: user-pinned trail is never adjusted", () => {
  const st = stepExit({ kind: "watching", peak: 12 }, 10, 12, FIXED);
  assert.equal(st.trailPct, 0.02);
  assert.equal(st.trailMode, "fixed");
});

test("tighter ratchet actually fires earlier", () => {
  const cfg: ExitConfig = { trailPct: 0.03, stopLossPct: 0.03, trailMode: "atr" };
  // peak 11.2 (12% pnl) -> effective trail 1.65% -> target ≈ 11.015
  const st = stepExit({ kind: "watching", peak: 11.2 }, 10, 11.0, cfg);
  assert.equal(st.kind, "take_profit_warn");
});
