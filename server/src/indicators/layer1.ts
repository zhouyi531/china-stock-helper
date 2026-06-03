import type { Layer1Metrics, Quote, TrendTag } from "../types.js";
import type { DailyBar } from "../providers/index.js";
import { clamp, mean, round, sma, stddev } from "../util/math.js";

export interface Layer1Context {
  /** Daily bars in chronological order; the last bar is today (close = current). */
  daily: DailyBar[];
  /** Recent intraday prices (chronological) used for momentum, e.g. last ~5 min. */
  recentPrices: number[];
  /** Fraction (0..1) of the trading day elapsed, for relative-volume fallback. */
  elapsedFraction: number;
}

function safePct(numerator: number, denom: number): number {
  return denom > 0 ? (numerator / denom) * 100 : 0;
}

function computeRelativeVolume(quote: Quote, ctx: Layer1Context): number {
  if (quote.volumeRatio > 0) return quote.volumeRatio; // 量比 from source
  const prev = ctx.daily.slice(0, -1).map((b) => b.volume).filter((v) => v > 0);
  const base = mean(prev.slice(-5));
  if (base <= 0 || ctx.elapsedFraction <= 0) return 0;
  const projected = quote.volume / ctx.elapsedFraction;
  return projected / base;
}

function computeVolatility(ctx: Layer1Context): number {
  const closes = ctx.daily.map((b) => b.close).filter((c) => c > 0);
  if (closes.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    rets.push(closes[i] / closes[i - 1] - 1);
  }
  return stddev(rets.slice(-20)) * 100;
}

function computeMomentum(ctx: Layer1Context): number {
  const p = ctx.recentPrices.filter((x) => x > 0);
  if (p.length < 2) return 0;
  const first = p[0];
  const last = p[p.length - 1];
  return safePct(last - first, first);
}

function scoreTrend(m: Omit<Layer1Metrics, "trendScore" | "trendTag">): number {
  let s = 50;
  s += (clamp(m.priceVsVwap, -3, 3) / 3) * 12;
  s += (clamp(m.intradayMomentum, -2, 2) / 2) * 10;
  s += (clamp(m.pctChange, -5, 5) / 5) * 8;
  s += m.orderBookImbalance * 6;

  // volume conviction in the direction of the move
  const dir = Math.sign(m.priceVsVwap || m.pctChange);
  s += dir * clamp(m.relativeVolume - 1, -1, 2) * 5;

  // MA alignment
  const { price, ma5, ma10, ma20 } = m;
  if (ma5 != null && ma10 != null && ma20 != null) {
    if (price > ma5 && ma5 > ma10 && ma10 > ma20) s += 12;
    else if (price < ma5 && ma5 < ma10 && ma10 < ma20) s -= 12;
    else {
      if (price > ma5) s += 3;
      if (ma5 > ma10) s += 3;
      if (ma10 > ma20) s += 3;
      if (price < ma5) s -= 3;
      if (ma5 < ma10) s -= 3;
      if (ma10 < ma20) s -= 3;
    }
  }
  return clamp(round(s, 1), 0, 100);
}

function tagOf(score: number): TrendTag {
  if (score >= 62) return "bull";
  if (score <= 38) return "bear";
  return "neutral";
}

export function computeLayer1(quote: Quote, ctx: Layer1Context): Layer1Metrics {
  const closes = ctx.daily.map((b) => b.close);
  const vwap = quote.avgPrice > 0 ? quote.avgPrice : quote.price;

  const bidVol = quote.bids.reduce((a, b) => a + b.volume, 0);
  const askVol = quote.asks.reduce((a, b) => a + b.volume, 0);
  const imbalance =
    bidVol + askVol > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;
  const bid1 = quote.bids[0]?.price ?? 0;
  const ask1 = quote.asks[0]?.price ?? 0;

  const base = {
    price: quote.price,
    pctChange: round(safePct(quote.price - quote.prevClose, quote.prevClose), 2),
    gapPct: round(safePct(quote.open - quote.prevClose, quote.prevClose), 2),
    vwap: round(vwap, 3),
    priceVsVwap: round(safePct(quote.price - vwap, vwap), 2),
    ma5: round2OrNull(sma(closes, 5)),
    ma10: round2OrNull(sma(closes, 10)),
    ma20: round2OrNull(sma(closes, 20)),
    intradayMomentum: round(computeMomentum(ctx), 2),
    relativeVolume: round(computeRelativeVolume(quote, ctx), 2),
    turnoverRate: round(quote.turnoverRate, 2),
    amplitude: round(
      quote.amplitude > 0
        ? quote.amplitude
        : safePct(quote.high - quote.low, quote.prevClose),
      2
    ),
    volatility: round(computeVolatility(ctx), 2),
    distanceToLimitUp:
      quote.limitUp > 0 ? round(safePct(quote.limitUp - quote.price, quote.price), 2) : 0,
    distanceToLimitDown:
      quote.limitDown > 0 ? round(safePct(quote.price - quote.limitDown, quote.price), 2) : 0,
    bidAskSpread:
      bid1 > 0 && ask1 > 0 ? round(safePct(ask1 - bid1, quote.price), 3) : 0,
    orderBookImbalance: round(imbalance, 3),
  };

  const trendScore = scoreTrend(base);
  return { ...base, trendScore, trendTag: tagOf(trendScore) };
}

function round2OrNull(x: number | null): number | null {
  return x == null ? null : round(x, 3);
}
