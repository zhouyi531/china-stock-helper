import { config } from "../config.js";

export function tushareEnabled(): boolean {
  return !!config.tushareToken;
}

interface TushareData {
  fields: string[];
  items: unknown[][];
}

/** Generic Tushare Pro RPC call. Returns null when disabled or on any error. */
export async function tushareCall(
  apiName: string,
  params: Record<string, unknown> = {},
  fields = ""
): Promise<TushareData | null> {
  if (!tushareEnabled()) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch("https://api.tushare.pro", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_name: apiName, token: config.tushareToken, params, fields }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const json: any = await res.json();
    if (json?.code !== 0 || !json?.data) return null;
    return json.data as TushareData;
  } catch {
    return null;
  }
}

function ymd(d = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** Fallback limit-up/down counts via Tushare limit_list_d. */
export async function tushareLimitCounts(): Promise<{
  limitUp: number;
  limitDown: number;
  available: boolean;
}> {
  const data = await tushareCall(
    "limit_list_d",
    { trade_date: ymd() },
    "ts_code,limit"
  );
  if (!data) return { limitUp: 0, limitDown: 0, available: false };
  const li = data.fields.indexOf("limit");
  let up = 0;
  let down = 0;
  for (const row of data.items) {
    const v = String(row[li]);
    if (v === "U") up++;
    else if (v === "D") down++;
  }
  return { limitUp: up, limitDown: down, available: true };
}
