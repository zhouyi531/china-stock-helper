export function cls(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}

export function fmt(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

export function fmtSigned(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(dp)}`;
}

export function fmtPct(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

/** A-share convention: red = up, green = down. */
export function upDownClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "text-slate-400";
  return n > 0 ? "text-up" : "text-down";
}

export function fmtAmount(yuan: number | null | undefined): string {
  if (yuan == null || !Number.isFinite(yuan) || yuan === 0) return "—";
  if (yuan >= 1e8) return `${(yuan / 1e8).toFixed(2)}亿`;
  if (yuan >= 1e4) return `${(yuan / 1e4).toFixed(1)}万`;
  return `${yuan.toFixed(0)}`;
}

/** volume is in 手 (lots); render in 手/万手. */
export function fmtVolume(lots: number | null | undefined): string {
  if (lots == null || !Number.isFinite(lots) || lots === 0) return "—";
  if (lots >= 1e4) return `${(lots / 1e4).toFixed(1)}万手`;
  return `${lots.toFixed(0)}手`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}秒前`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}分钟前`;
  const h = Math.round(m / 60);
  return `${h}小时前`;
}
