import type { Layer1Metrics, Quote, TrendTag } from "../types.js";
import type { DailyBar } from "../providers/index.js";
import { atr, clamp, kdj, macd, mean, round, rsi, sma, stddev } from "../util/math.js";

export interface TickPoint {
  t: number;
  price: number;
}

export interface Layer1Context {
  /** Daily bars in chronological order (qfq). May or may not include today. */
  daily: DailyBar[];
  /** Recent intraday ticks (chronological), kept for ~15 minutes. */
  ticks: TickPoint[];
  /** Expected cumulative volume fraction of the day (U-shaped curve), 0..1. */
  volumeFraction: number;
  /** Today's date in Shanghai, "yyyy-mm-dd" — to detect today's bar. */
  todayIso: string;
}

function safePct(numerator: number, denom: number): number {
  return denom > 0 ? (numerator / denom) * 100 : 0;
}

/**
 * Merge the live quote into the daily series so indicators update tick-by-tick:
 * patch today's bar if present, otherwise append a synthetic bar for today.
 * Returns { bars, hasToday } where bars ALWAYS end with today's live bar
 * (when the quote is sane) and `completed` excludes it.
 */
function withLiveBar(daily: DailyBar[], quote: Quote, todayIso: string): {
  bars: DailyBar[];
  completed: DailyBar[];
} {
  if (quote.price <= 0) return { bars: daily, completed: daily };
  const live: DailyBar = {
    date: todayIso,
    open: quote.open > 0 ? quote.open : quote.price,
    close: quote.price,
    high: Math.max(quote.high, quote.price) || quote.price,
    low: quote.low > 0 ? Math.min(quote.low, quote.price) : quote.price,
    volume: quote.volume,
  };
  if (daily.length === 0) return { bars: [live], completed: [] };
  const last = daily[daily.length - 1];
  if (last.date === todayIso) {
    return { bars: [...daily.slice(0, -1), live], completed: daily.slice(0, -1) };
  }
  // Off-hours (e.g. weekend): the last fetched bar IS the latest completed
  // day and the quote belongs to it. Avoid double-appending.
  if (last.close === quote.price && quote.volume === last.volume) {
    return { bars: daily, completed: daily.slice(0, -1) };
  }
  return { bars: [...daily, live], completed: daily };
}

function computeRelativeVolume(quote: Quote, completed: DailyBar[], volumeFraction: number): number {
  if (quote.volumeRatio > 0) return quote.volumeRatio; // 量比 from source (best)
  const prev = completed.map((b) => b.volume).filter((v) => v > 0);
  const base = mean(prev.slice(-5));
  if (base <= 0 || volumeFraction <= 0) return 0;
  const projected = quote.volume / volumeFraction;
  return projected / base;
}

function computeVolatility(closes: number[]): number {
  if (closes.length < 3) return 0;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  }
  return stddev(rets.slice(-20)) * 100;
}

function momentumOver(ticks: TickPoint[], windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  const p = ticks.filter((x) => x.t >= cutoff && x.price > 0);
  if (p.length < 2) return 0;
  return safePct(p[p.length - 1].price - p[0].price, p[0].price);
}

// ---------------------------------------------------------------------------
// Daily-timeframe score: "is this a stock worth buying" (direction & quality)
// ---------------------------------------------------------------------------

interface DailyIndicators {
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;
  macdHistPrev: number | null;
  rsi14: number | null;
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;
  atrPct: number | null;
  ret5d: number | null;
  ret20d: number | null;
  pos60d: number | null;
  distToHigh20: number | null;
  volTrend: number | null;
  ma20Slope: number | null;
}

function computeDailyIndicators(
  bars: DailyBar[],
  completed: DailyBar[],
  price: number
): DailyIndicators {
  const closes = bars.map((b) => b.close).filter((c) => c > 0);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);

  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);

  const macdSeries = macd(closes);
  const last = macdSeries ? macdSeries[macdSeries.length - 1] : null;
  const prev = macdSeries && macdSeries.length > 1 ? macdSeries[macdSeries.length - 2] : null;

  const r = rsi(closes, 14);
  const k = kdj(highs, lows, closes, 9);

  const a = atr(bars, 14);
  const atrPct = a != null && price > 0 ? (a / price) * 100 : null;

  const retOver = (n: number): number | null => {
    if (closes.length < n + 1) return null;
    const base = closes[closes.length - 1 - n];
    return base > 0 ? ((price - base) / base) * 100 : null;
  };

  let pos60d: number | null = null;
  if (bars.length >= 20) {
    const lookback = bars.slice(-60);
    const hi = Math.max(...lookback.map((b) => b.high));
    const lo = Math.min(...lookback.map((b) => b.low));
    pos60d = hi > lo ? clamp(((price - lo) / (hi - lo)) * 100, 0, 100) : 50;
  }

  // highest high of the PREVIOUS 20 completed days (excludes today's bar)
  let distToHigh20: number | null = null;
  if (completed.length >= 20) {
    const h20 = Math.max(...completed.slice(-20).map((b) => b.high));
    if (h20 > 0 && price > 0) distToHigh20 = ((h20 - price) / price) * 100;
  }

  let volTrend: number | null = null;
  const vols = completed.map((b) => b.volume).filter((v) => v > 0);
  if (vols.length >= 20) {
    const v5 = mean(vols.slice(-5));
    const v20 = mean(vols.slice(-20));
    if (v20 > 0) volTrend = v5 / v20;
  }

  let ma20Slope: number | null = null;
  if (closes.length >= 25) {
    const cur = mean(closes.slice(-20));
    const past = mean(closes.slice(-25, -5));
    if (past > 0) ma20Slope = (cur / past - 1) * 100;
  }

  return {
    ma5,
    ma10,
    ma20,
    ma60,
    macdDif: last?.dif ?? null,
    macdDea: last?.dea ?? null,
    macdHist: last?.hist ?? null,
    macdHistPrev: prev?.hist ?? null,
    rsi14: r,
    kdjK: k?.k ?? null,
    kdjD: k?.d ?? null,
    kdjJ: k?.j ?? null,
    atrPct,
    ret5d: retOver(5),
    ret20d: retOver(20),
    pos60d,
    distToHigh20,
    volTrend,
    ma20Slope,
  };
}

/**
 * Daily trend quality 0..100. Base 50. Max swing ≈ ±50.
 *  - 均线结构 ±12.5  - MA20斜率 ±6  - MACD ±10  - RSI ±8(过热罚分)
 *  - 20日突破 +8/-6  - 60日位置 ±5  - 5日动量 ±5  - 量价配合 ±5
 */
function scoreDaily(d: DailyIndicators, price: number): number | null {
  if (d.ma20 == null) return null; // too little history to call a daily trend
  let s = 50;

  // MA structure
  const conds = [
    d.ma5 != null && price > d.ma5,
    d.ma5 != null && d.ma10 != null && d.ma5 > d.ma10,
    d.ma10 != null && d.ma20 != null && d.ma10 > d.ma20,
    d.ma60 == null || price > d.ma60,
  ];
  for (const c of conds) s += c ? 2.5 : -2.5;
  if (conds[0] && conds[1] && conds[2]) s += 2.5; // clean bullish stack bonus
  if (!conds[0] && !conds[1] && !conds[2]) s -= 2.5;

  if (d.ma20Slope != null) s += (clamp(d.ma20Slope, -3, 3) / 3) * 6;

  if (d.macdHist != null) {
    s += d.macdHist > 0 ? 5 : -5;
    if (d.macdHistPrev != null) s += d.macdHist > d.macdHistPrev ? 3 : -3;
    if (d.macdDif != null) s += d.macdDif > 0 ? 2 : -2;
  }

  if (d.rsi14 != null) {
    s += ((clamp(d.rsi14, 20, 80) - 50) / 30) * 8;
    if (d.rsi14 > 80) s -= 4; // 过热
    if (d.rsi14 < 20) s += 2; // 超跌修复潜力
  }

  if (d.distToHigh20 != null) {
    if (d.distToHigh20 <= 0) s += 8; // 已突破20日新高
    else if (d.distToHigh20 <= 1) s += 5; // 临近突破
  }
  if (d.pos60d != null) {
    s += ((d.pos60d - 50) / 50) * 5;
    if (d.pos60d < 8) s -= 4; // 贴着60日低位，弱势
  }

  if (d.ret5d != null) s += (clamp(d.ret5d, -8, 8) / 8) * 5;

  if (d.volTrend != null && d.ret5d != null) {
    if (d.volTrend >= 1.2 && d.ret5d > 0) s += 5; // 放量上行
    else if (d.volTrend >= 1.2 && d.ret5d < -2) s -= 5; // 放量下跌
    else if (d.volTrend <= 0.8 && d.ret5d < 0 && d.ma20 != null && price > d.ma20)
      s += 3; // 缩量回调到位、趋势未破
  }

  return clamp(round(s, 1), 0, 100);
}

// ---------------------------------------------------------------------------
// Intraday score: "is NOW a good moment" (timing)
// ---------------------------------------------------------------------------

interface IntradayInput {
  priceVsVwap: number;
  mom5: number;
  mom15: number;
  pctChange: number;
  gapPct: number;
  orderBookImbalance: number;
  relativeVolume: number;
  dayRangePos: number | null;
  distanceToLimitUp: number;
  price: number;
  open: number;
  ma5: number | null;
  ma20: number | null;
}

/**
 * Intraday strength 0..100. Base 50. Max swing ≈ ±56.
 *  - VWAP ±12  - 5分钟动量 ±8  - 15分钟动量 ±4  - 当日涨跌 ±8  - 盘口 ±6
 *  - 量能配合 +10/-5  - 日内位置 ±6  - 缺口行为 ±4  - 涨停磁吸 +4  - 均线上下 ±4
 */
function scoreIntraday(m: IntradayInput): number {
  let s = 50;
  s += (clamp(m.priceVsVwap, -3, 3) / 3) * 12;
  s += (clamp(m.mom5, -2, 2) / 2) * 8;
  s += (clamp(m.mom15, -3, 3) / 3) * 4;
  s += (clamp(m.pctChange, -5, 5) / 5) * 8;
  s += m.orderBookImbalance * 6;

  // volume conviction in the direction of the move
  const dir = Math.sign(m.priceVsVwap || m.pctChange);
  s += dir * clamp(m.relativeVolume - 1, -1, 2) * 5;

  if (m.dayRangePos != null) s += ((m.dayRangePos - 50) / 50) * 6;

  // gap behaviour: fading a big gap-up is bearish, holding above open is healthy
  if (m.gapPct > 2 && m.open > 0 && m.price < m.open) s -= 4;
  else if (m.gapPct > 0 && m.open > 0 && m.price > m.open) s += 2;

  // limit-up magnet: strong stocks near the limit with volume tend to seal
  if (m.distanceToLimitUp > 0 && m.distanceToLimitUp <= 1.5 && m.relativeVolume >= 1.5) s += 4;

  // light daily-MA context (full structure lives in dailyScore)
  if (m.ma5 != null) s += m.price > m.ma5 ? 2 : -2;
  if (m.ma20 != null) s += m.price > m.ma20 ? 2 : -2;

  return clamp(round(s, 1), 0, 100);
}

function tagOf(score: number): TrendTag {
  if (score >= 62) return "bull";
  if (score <= 38) return "bear";
  return "neutral";
}

// ---------------------------------------------------------------------------

export function computeLayer1(quote: Quote, ctx: Layer1Context): Layer1Metrics {
  const { bars, completed } = withLiveBar(ctx.daily, quote, ctx.todayIso);
  const closes = bars.map((b) => b.close).filter((c) => c > 0);
  const vwap = quote.avgPrice > 0 ? quote.avgPrice : quote.price;

  const bidVol = quote.bids.reduce((a, b) => a + b.volume, 0);
  const askVol = quote.asks.reduce((a, b) => a + b.volume, 0);
  const imbalance = bidVol + askVol > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;
  const bid1 = quote.bids[0]?.price ?? 0;
  const ask1 = quote.asks[0]?.price ?? 0;

  const d = computeDailyIndicators(bars, completed, quote.price);
  const relativeVolume = computeRelativeVolume(quote, completed, ctx.volumeFraction);

  const dayRangePos =
    quote.high > quote.low && quote.low > 0
      ? clamp(((quote.price - quote.low) / (quote.high - quote.low)) * 100, 0, 100)
      : null;

  const mom5 = momentumOver(ctx.ticks, 5 * 60 * 1000);
  const mom15 = momentumOver(ctx.ticks, 15 * 60 * 1000);

  const priceVsVwap = round(safePct(quote.price - vwap, vwap), 2);
  const pctChange = round(safePct(quote.price - quote.prevClose, quote.prevClose), 2);
  const gapPct = round(safePct(quote.open - quote.prevClose, quote.prevClose), 2);
  const distanceToLimitUp =
    quote.limitUp > 0 ? round(safePct(quote.limitUp - quote.price, quote.price), 2) : 0;

  const intradayScore = scoreIntraday({
    priceVsVwap,
    mom5,
    mom15,
    pctChange,
    gapPct,
    orderBookImbalance: imbalance,
    relativeVolume,
    dayRangePos,
    distanceToLimitUp,
    price: quote.price,
    open: quote.open,
    ma5: d.ma5,
    ma20: d.ma20,
  });

  const dailyScore = scoreDaily(d, quote.price);

  // fused per-stock score: direction (daily) × timing (intraday)
  const trendScore =
    dailyScore != null
      ? clamp(round(0.55 * intradayScore + 0.45 * dailyScore, 1), 0, 100)
      : intradayScore;

  return {
    price: quote.price,
    pctChange,
    gapPct,
    vwap: round(vwap, 3),
    priceVsVwap,
    ma5: roundOrNull(d.ma5),
    ma10: roundOrNull(d.ma10),
    ma20: roundOrNull(d.ma20),
    ma60: roundOrNull(d.ma60),
    intradayMomentum: round(mom5, 2),
    intradayMomentum15: round(mom15, 2),
    relativeVolume: round(relativeVolume, 2),
    turnoverRate: round(quote.turnoverRate, 2),
    amplitude: round(
      quote.amplitude > 0 ? quote.amplitude : safePct(quote.high - quote.low, quote.prevClose),
      2
    ),
    volatility: round(computeVolatility(closes), 2),
    distanceToLimitUp,
    distanceToLimitDown:
      quote.limitDown > 0 ? round(safePct(quote.price - quote.limitDown, quote.price), 2) : 0,
    bidAskSpread: bid1 > 0 && ask1 > 0 ? round(safePct(ask1 - bid1, quote.price), 3) : 0,
    orderBookImbalance: round(imbalance, 3),
    dayRangePos: dayRangePos != null ? round(dayRangePos, 1) : null,

    macdDif: roundOrNull(d.macdDif, 4),
    macdDea: roundOrNull(d.macdDea, 4),
    macdHist: roundOrNull(d.macdHist, 4),
    macdHistPrev: roundOrNull(d.macdHistPrev, 4),
    rsi14: roundOrNull(d.rsi14, 1),
    kdjK: roundOrNull(d.kdjK, 1),
    kdjD: roundOrNull(d.kdjD, 1),
    kdjJ: roundOrNull(d.kdjJ, 1),
    atrPct: roundOrNull(d.atrPct, 2),
    ret5d: roundOrNull(d.ret5d, 2),
    ret20d: roundOrNull(d.ret20d, 2),
    pos60d: roundOrNull(d.pos60d, 1),
    distToHigh20: roundOrNull(d.distToHigh20, 2),
    volTrend: roundOrNull(d.volTrend, 2),
    ma20Slope: roundOrNull(d.ma20Slope, 2),

    intradayScore,
    dailyScore,
    trendScore,
    trendTag: tagOf(trendScore),
  };
}

function roundOrNull(x: number | null, dp = 3): number | null {
  return x == null ? null : round(x, dp);
}
