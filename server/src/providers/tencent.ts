import { fetchText, fetchJson, toNum } from "./http.js";
import { splitSymbol } from "../symbols.js";
import type { OrderBookLevel, Quote, Symbol } from "../types.js";

const QUOTE_HEADERS = { Referer: "https://gu.qq.com/" };
const KLINE_HEADERS = { Referer: "https://gu.qq.com/" };

/** Parse Tencent timestamp "yyyymmddHHMMSS" -> epoch ms. */
function parseTs(s: string): number {
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return Date.now();
  const [, y, mo, d, h, mi, se] = m;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se)
  ).getTime();
}

/**
 * Parse one Tencent quote payload (the string inside v_xxx="...").
 * Field indices were verified against live responses.
 */
function parseQuoteParts(symbol: Symbol, parts: string[]): Quote | null {
  if (parts.length < 50) return null;
  const { market } = splitSymbol(symbol);
  const price = toNum(parts[3]);
  const prevClose = toNum(parts[4]);

  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  for (let i = 0; i < 5; i++) {
    const bp = toNum(parts[9 + i * 2]);
    const bv = toNum(parts[10 + i * 2]);
    const ap = toNum(parts[19 + i * 2]);
    const av = toNum(parts[20 + i * 2]);
    if (bp > 0) bids.push({ price: bp, volume: bv });
    if (ap > 0) asks.push({ price: ap, volume: av });
  }

  // parts[35] = "price/volume(手)/amount(元)" gives an exact amount.
  let amount = 0;
  if (parts[35]?.includes("/")) {
    amount = toNum(parts[35].split("/")[2]);
  }
  if (!amount) amount = toNum(parts[37]) * 10000; // 万元 -> 元

  const volume = toNum(parts[6]); // 手
  const avgFromField = toNum(parts[51]);
  const avgPrice =
    avgFromField > 0
      ? avgFromField
      : volume > 0
        ? amount / (volume * 100)
        : price;

  return {
    symbol,
    code: parts[2] || splitSymbol(symbol).code,
    name: parts[1] ?? "",
    market,
    price,
    prevClose,
    open: toNum(parts[5]),
    high: toNum(parts[33]),
    low: toNum(parts[34]),
    volume,
    amount,
    avgPrice,
    turnoverRate: toNum(parts[38]),
    amplitude: toNum(parts[43]),
    volumeRatio: toNum(parts[49]),
    limitUp: toNum(parts[47]),
    limitDown: toNum(parts[48]),
    pe: toNum(parts[39]),
    pb: toNum(parts[46]),
    bids,
    asks,
    ts: parseTs(parts[30] ?? ""),
    stale: false,
  };
}

/** Batch quotes for many symbols in one request. */
export async function fetchTencentQuotes(symbols: Symbol[]): Promise<Map<Symbol, Quote>> {
  const out = new Map<Symbol, Quote>();
  if (symbols.length === 0) return out;
  const url = `https://qt.gtimg.cn/q=${symbols.join(",")}`;
  const text = await fetchText(url, "gbk", { headers: QUOTE_HEADERS, timeoutMs: 8000 });
  const re = /v_(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const symbol = m[1] as Symbol;
    const parts = m[2].split("~");
    const q = parseQuoteParts(symbol, parts);
    if (q && q.price > 0) out.set(symbol, q);
  }
  return out;
}

export interface DailyBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number; // 手
}

/** Daily K-line (qfq adjusted) for MA / volatility / volume baseline. */
export async function fetchTencentDaily(
  symbol: Symbol,
  count = 60
): Promise<DailyBar[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${count},qfq`;
  const json = await fetchJson<any>(url, { headers: KLINE_HEADERS, timeoutMs: 9000 });
  const node = json?.data?.[symbol];
  const rows: any[] = node?.qfqday ?? node?.day ?? [];
  return rows.map((r) => ({
    date: r[0],
    open: toNum(r[1]),
    close: toNum(r[2]),
    high: toNum(r[3]),
    low: toNum(r[4]),
    volume: toNum(r[5]),
  }));
}

export interface MinuteBar {
  time: string; // HHMM
  price: number;
  cumVolume: number; // 手
  cumAmount: number; // 元
}

/** Today's minute series for intraday momentum. */
export async function fetchTencentMinute(symbol: Symbol): Promise<MinuteBar[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${symbol}`;
  const json = await fetchJson<any>(url, { headers: KLINE_HEADERS, timeoutMs: 9000 });
  const rows: string[] = json?.data?.[symbol]?.data?.data ?? [];
  return rows
    .map((line) => {
      const seg = line.trim().split(/\s+/);
      return {
        time: seg[0],
        price: toNum(seg[1]),
        cumVolume: toNum(seg[2]),
        cumAmount: toNum(seg[3]),
      };
    })
    .filter((b) => b.price > 0);
}
