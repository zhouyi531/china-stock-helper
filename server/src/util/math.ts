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
