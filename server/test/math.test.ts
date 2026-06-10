import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atr,
  emaSeries,
  highest,
  kdj,
  lowest,
  macd,
  percentileRank,
  rsi,
  sma,
} from "../src/util/math.js";

test("sma basics", () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(sma([1, 2, 3], 5), null);
  assert.equal(sma([1, 2, 3, 4, 5, 6], 2), 5.5);
});

test("highest / lowest", () => {
  assert.equal(highest([1, 5, 3, 2], 3), 5);
  assert.equal(lowest([4, 1, 3, 2], 2), 2);
  assert.equal(highest([1, 2], 5), null);
});

test("emaSeries: converges toward a constant level", () => {
  const xs = Array(50).fill(10);
  const e = emaSeries(xs, 12);
  assert.ok(Math.abs(e[e.length - 1] - 10) < 1e-9);
  // rising series: ema lags below the last value
  const rising = Array.from({ length: 50 }, (_, i) => i + 1);
  const er = emaSeries(rising, 12);
  assert.ok(er[er.length - 1] < 50);
  assert.ok(er[er.length - 1] > 40);
});

test("macd: positive in a steady uptrend, negative in a downtrend", () => {
  const up = Array.from({ length: 80 }, (_, i) => 10 * Math.pow(1.01, i));
  const mUp = macd(up)!;
  const lastUp = mUp[mUp.length - 1];
  assert.ok(lastUp.dif > 0, "DIF should be positive in an uptrend");
  assert.ok(lastUp.hist === 2 * (lastUp.dif - lastUp.dea), "Chinese hist = 2×(DIF−DEA)");

  const down = Array.from({ length: 80 }, (_, i) => 100 * Math.pow(0.99, i));
  const mDown = macd(down)!;
  assert.ok(mDown[mDown.length - 1].dif < 0, "DIF should be negative in a downtrend");

  assert.equal(macd([1, 2, 3]), null, "insufficient history -> null");
});

test("rsi: extremes and neutrality", () => {
  const allUp = Array.from({ length: 30 }, (_, i) => 10 + i);
  assert.equal(rsi(allUp, 14), 100);

  const allDown = Array.from({ length: 30 }, (_, i) => 100 - i);
  const r = rsi(allDown, 14)!;
  assert.ok(r < 5, `all-down RSI should be ~0, got ${r}`);

  // alternating equal up/down -> RSI near 50
  const alt: number[] = [50];
  for (let i = 0; i < 40; i++) alt.push(alt[alt.length - 1] + (i % 2 === 0 ? 1 : -1));
  const rAlt = rsi(alt, 14)!;
  assert.ok(rAlt > 40 && rAlt < 60, `alternating RSI should be near 50, got ${rAlt}`);

  assert.equal(rsi([1, 2], 14), null);
});

test("kdj: bounded and directional", () => {
  const n = 30;
  const closesUp = Array.from({ length: n }, (_, i) => 10 + i * 0.5);
  const highs = closesUp.map((c) => c + 0.2);
  const lows = closesUp.map((c) => c - 0.2);
  const k = kdj(highs, lows, closesUp, 9)!;
  assert.ok(k.k > 60, `K should be high in an uptrend, got ${k.k}`);
  assert.ok(k.k >= 0 && k.k <= 100);
  assert.ok(k.d >= 0 && k.d <= 100);
  assert.equal(kdj([1], [1], [1], 9), null);
});

test("atr: matches hand-computed constant true range", () => {
  // constant daily range of 2 with no gaps: TR = 2 every day -> ATR = 2
  const bars = Array.from({ length: 30 }, (_, i) => ({
    high: 11,
    low: 9,
    close: 10,
    open: 10,
    date: String(i),
    volume: 100,
  }));
  const a = atr(bars, 14)!;
  assert.ok(Math.abs(a - 2) < 1e-9, `ATR should be 2, got ${a}`);
  assert.equal(atr(bars.slice(0, 10), 14), null);
});

test("percentileRank", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.ok(percentileRank(xs, 10) >= 0.9);
  assert.ok(percentileRank(xs, 1) <= 0.1);
  const mid = percentileRank(xs, 5.5);
  assert.ok(mid > 0.4 && mid < 0.6);
});
