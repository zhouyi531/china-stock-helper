import { fetchText, toNum } from "./http.js";
import { splitSymbol } from "../symbols.js";
import type { OrderBookLevel, Quote, Symbol } from "../types.js";

const SINA_HEADERS = { Referer: "https://finance.sina.com.cn/" };

/** Best-effort price-limit ratio by board (no ST awareness). */
function limitRatio(symbol: Symbol): number {
  const { code } = splitSymbol(symbol);
  if (code.startsWith("300") || code.startsWith("301") || code.startsWith("688"))
    return 0.2; // ChiNext / STAR
  if (
    code.startsWith("43") ||
    code.startsWith("83") ||
    code.startsWith("87") ||
    code.startsWith("88") ||
    code.startsWith("92")
  )
    return 0.3; // Beijing
  return 0.1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseSina(symbol: Symbol, body: string): Quote | null {
  const p = body.split(",");
  if (p.length < 32) return null;
  const { market } = splitSymbol(symbol);
  const price = toNum(p[3]);
  const prevClose = toNum(p[2]);
  if (price <= 0 && prevClose <= 0) return null;

  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];
  for (let i = 0; i < 5; i++) {
    const bv = toNum(p[10 + i * 2]) / 100; // shares -> 手
    const bp = toNum(p[11 + i * 2]);
    const av = toNum(p[20 + i * 2]) / 100;
    const ap = toNum(p[21 + i * 2]);
    if (bp > 0) bids.push({ price: bp, volume: bv });
    if (ap > 0) asks.push({ price: ap, volume: av });
  }

  const volumeShares = toNum(p[8]);
  const volume = volumeShares / 100; // 手
  const amount = toNum(p[9]); // 元
  const ratio = limitRatio(symbol);

  return {
    symbol,
    code: splitSymbol(symbol).code,
    name: p[0] ?? "",
    market,
    price: price || prevClose,
    prevClose,
    open: toNum(p[1]),
    high: toNum(p[4]),
    low: toNum(p[5]),
    volume,
    amount,
    avgPrice: volumeShares > 0 ? amount / volumeShares : price,
    turnoverRate: 0,
    amplitude:
      prevClose > 0 ? ((toNum(p[4]) - toNum(p[5])) / prevClose) * 100 : 0,
    volumeRatio: 0,
    limitUp: round2(prevClose * (1 + ratio)),
    limitDown: round2(prevClose * (1 - ratio)),
    pe: 0,
    pb: 0,
    bids,
    asks,
    ts: Date.now(),
    stale: false,
  };
}

export async function fetchSinaQuotes(symbols: Symbol[]): Promise<Map<Symbol, Quote>> {
  const out = new Map<Symbol, Quote>();
  if (symbols.length === 0) return out;
  const url = `https://hq.sinajs.cn/list=${symbols.join(",")}`;
  const text = await fetchText(url, "gbk", { headers: SINA_HEADERS, timeoutMs: 8000 });
  const re = /hq_str_(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const symbol = m[1] as Symbol;
    if (!m[2]) continue;
    const q = parseSina(symbol, m[2]);
    if (q && q.price > 0) out.set(symbol, q);
  }
  return out;
}
