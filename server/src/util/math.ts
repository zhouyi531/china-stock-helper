export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

/** Simple moving average of the last `n` values. Returns null if insufficient. */
export function sma(xs: number[], n: number): number | null {
  if (xs.length < n) return null;
  return mean(xs.slice(-n));
}

/** Highest value of the last `n` entries (null if insufficient). */
export function highest(xs: number[], n: number): number | null {
  if (xs.length < n || n <= 0) return null;
  return Math.max(...xs.slice(-n));
}

/** Lowest value of the last `n` entries (null if insufficient). */
export function lowest(xs: number[], n: number): number | null {
  if (xs.length < n || n <= 0) return null;
  return Math.min(...xs.slice(-n));
}

/** Exponential moving average series (same length as input). */
export function emaSeries(xs: number[], n: number): number[] {
  if (xs.length === 0) return [];
  const k = 2 / (n + 1);
  const out: number[] = [xs[0]];
  for (let i = 1; i < xs.length; i++) {
    out.push(xs[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export interface MacdPoint {
  dif: number;
  dea: number;
  /** Chinese-convention MACD bar = 2 × (DIF − DEA), as displayed by 同花顺/东财. */
  hist: number;
}

/**
 * MACD(12, 26, 9) over a close series. Returns null when there is not enough
 * history for the slow EMA to be meaningful (< 26 bars).
 */
export function macd(closes: number[], fast = 12, slow = 26, signal = 9): MacdPoint[] | null {
  if (closes.length < slow) return null;
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const dif = ef.map((v, i) => v - es[i]);
  const dea = emaSeries(dif, signal);
  return dif.map((d, i) => ({ dif: d, dea: dea[i], hist: 2 * (d - dea[i]) }));
}

/**
 * Wilder RSI of the last point of a close series. Returns null with fewer
 * than n+1 closes. Seeded with a simple average over the first n deltas,
 * then Wilder-smoothed across the remaining history.
 */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) deltas.push(closes[i] - closes[i - 1]);
  let avgGain = mean(deltas.slice(0, n).map((d) => (d > 0 ? d : 0)));
  let avgLoss = mean(deltas.slice(0, n).map((d) => (d < 0 ? -d : 0)));
  for (let i = n; i < deltas.length; i++) {
    const d = deltas[i];
    avgGain = (avgGain * (n - 1) + (d > 0 ? d : 0)) / n;
    avgLoss = (avgLoss * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface KdjPoint {
  k: number;
  d: number;
  j: number;
}

/**
 * Chinese-convention KDJ(9,3,3): RSV = (C−L9)/(H9−L9)×100,
 * K = 2/3·K' + 1/3·RSV, D = 2/3·D' + 1/3·K, J = 3K − 2D.
 * Returns the last point, or null with insufficient bars.
 */
export function kdj(
  highs: number[],
  lows: number[],
  closes: number[],
  n = 9
): KdjPoint | null {
  const len = closes.length;
  if (len < n || highs.length !== len || lows.length !== len) return null;
  let k = 50;
  let d = 50;
  for (let i = n - 1; i < len; i++) {
    const h = Math.max(...highs.slice(i - n + 1, i + 1));
    const l = Math.min(...lows.slice(i - n + 1, i + 1));
    const rsv = h > l ? ((closes[i] - l) / (h - l)) * 100 : 50;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }
  return { k, d, j: 3 * k - 2 * d };
}

/**
 * Wilder ATR over OHLC bars. Returns null with fewer than n+1 bars.
 * Bars are {high, low, close} in chronological order.
 */
export function atr(
  bars: { high: number; low: number; close: number }[],
  n = 14
): number | null {
  if (bars.length < n + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder smoothing seeded by the simple average of the first n TRs
  let a = mean(trs.slice(0, n));
  for (let i = n; i < trs.length; i++) {
    a = (a * (n - 1) + trs[i]) / n;
  }
  return a;
}

/** Percentile rank (0..1) of `x` within `sortedAsc`. */
export function percentileRank(sortedAsc: number[], x: number): number {
  if (sortedAsc.length === 0) return 0.5;
  let lo = 0;
  let hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return sortedAsc.length > 1 ? lo / sortedAsc.length : 0.5;
}
