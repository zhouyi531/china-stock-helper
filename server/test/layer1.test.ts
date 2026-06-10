import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLayer1, type Layer1Context } from "../src/indicators/layer1.js";
import type { Quote } from "../src/types.js";
import type { DailyBar } from "../src/providers/index.js";

function mkQuote(over: Partial<Quote> = {}): Quote {
  return {
    symbol: "sh600000",
    code: "600000",
    name: "测试",
    market: "sh",
    price: 12,
    prevClose: 11.5,
    open: 11.6,
    high: 12.1,
    low: 11.55,
    volume: 300000,
    amount: 3.6e8,
    avgPrice: 11.8,
    turnoverRate: 4,
    amplitude: 4.8,
    volumeRatio: 1.8,
    limitUp: 12.65,
    limitDown: 10.35,
    pe: 15,
    pb: 1.5,
    bids: [{ price: 11.99, volume: 800 }],
    asks: [{ price: 12.0, volume: 400 }],
    ts: Date.now(),
    stale: false,
    ...over,
  };
}

/** Synthetic gentle uptrend ending just below the live price. */
function mkDaily(n = 80, todayIso?: string): DailyBar[] {
  const bars: DailyBar[] = [];
  let price = 8;
  for (let i = 0; i < n; i++) {
    const drift = 1 + 0.004 * Math.sin(i / 7) + 0.003;
    const open = price;
    const close = price * drift;
    bars.push({
      date: `2025-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, "0")}`,
      open,
      close,
      high: Math.max(open, close) * 1.01,
      low: Math.min(open, close) * 0.99,
      volume: 200000 + (i % 10) * 5000,
    });
    price = close;
  }
  if (todayIso) bars[bars.length - 1].date = todayIso;
  return bars;
}

const CTX_BASE: Omit<Layer1Context, "daily"> = {
  ticks: [
    { t: Date.now() - 14 * 60 * 1000, price: 11.7 },
    { t: Date.now() - 4 * 60 * 1000, price: 11.85 },
    { t: Date.now() - 60 * 1000, price: 11.95 },
    { t: Date.now(), price: 12 },
  ],
  volumeFraction: 0.5,
  todayIso: "2025-06-11",
};

test("computeLayer1: all scores bounded, daily indicators populated", () => {
  const m = computeLayer1(mkQuote(), { ...CTX_BASE, daily: mkDaily(80) });
  assert.ok(m.intradayScore >= 0 && m.intradayScore <= 100);
  assert.ok(m.dailyScore != null && m.dailyScore >= 0 && m.dailyScore <= 100);
  assert.ok(m.trendScore >= 0 && m.trendScore <= 100);
  assert.ok(m.ma5 != null && m.ma20 != null && m.ma60 != null);
  assert.ok(m.macdHist != null, "MACD should be computed with 80 bars");
  assert.ok(m.rsi14 != null && m.rsi14 > 50, "uptrend RSI should exceed 50");
  assert.ok(m.atrPct != null && m.atrPct > 0);
  assert.ok(m.pos60d != null && m.pos60d > 60, "uptrend should sit high in 60d range");
  assert.ok(m.kdjK != null);
});

test("computeLayer1: uptrending stock above VWAP scores bullish on both frames", () => {
  const m = computeLayer1(mkQuote(), { ...CTX_BASE, daily: mkDaily(80) });
  assert.ok(m.dailyScore! >= 60, `dailyScore ${m.dailyScore}`);
  assert.ok(m.intradayScore >= 60, `intradayScore ${m.intradayScore}`);
  assert.equal(m.trendTag, "bull");
});

test("computeLayer1: 5min vs 15min momentum windows differ", () => {
  const m = computeLayer1(mkQuote(), { ...CTX_BASE, daily: mkDaily(80) });
  // 15-min window includes the 11.7 tick; 5-min starts at 11.85
  assert.ok(m.intradayMomentum15 > m.intradayMomentum);
});

test("computeLayer1: degrades gracefully without daily bars", () => {
  const m = computeLayer1(mkQuote(), { ...CTX_BASE, daily: [] });
  assert.equal(m.dailyScore, null);
  assert.equal(m.macdHist, null);
  assert.equal(m.trendScore, m.intradayScore, "fused score = intraday when no daily data");
});

test("computeLayer1: today's live bar patches an existing today row (no double count)", () => {
  const withToday = mkDaily(80, CTX_BASE.todayIso);
  const m = computeLayer1(mkQuote(), { ...CTX_BASE, daily: withToday });
  const m2 = computeLayer1(mkQuote(), { ...CTX_BASE, daily: mkDaily(80) });
  // both paths must produce valid, comparable indicators
  assert.ok(m.ma5 != null && m2.ma5 != null);
  assert.ok(Math.abs(m.ma5! - m2.ma5!) < 0.5);
});

test("computeLayer1: relative volume falls back to U-curve projection", () => {
  const q = mkQuote({ volumeRatio: 0, volume: 150000 });
  const m = computeLayer1(q, { ...CTX_BASE, daily: mkDaily(80), volumeFraction: 0.5 });
  // projected = 150000/0.5 = 300000 vs ~average 220k -> ratio > 1
  assert.ok(m.relativeVolume > 1, `got ${m.relativeVolume}`);
});

test("computeLayer1: falling knife day scores bearish intraday", () => {
  const q = mkQuote({
    price: 10.6,
    open: 11.4,
    high: 11.45,
    low: 10.55,
    avgPrice: 11.0,
    bids: [{ price: 10.59, volume: 200 }],
    asks: [{ price: 10.6, volume: 900 }],
  });
  const m = computeLayer1(q, {
    ...CTX_BASE,
    ticks: [
      { t: Date.now() - 10 * 60 * 1000, price: 11.2 },
      { t: Date.now() - 3 * 60 * 1000, price: 10.9 },
      { t: Date.now(), price: 10.6 },
    ],
    daily: mkDaily(80),
  });
  assert.ok(m.intradayScore < 40, `intradayScore ${m.intradayScore}`);
  assert.ok(m.dayRangePos != null && m.dayRangePos < 15);
});
