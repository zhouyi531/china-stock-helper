import { fetchJson, toNum } from "./http.js";
import { toEastMoneySecid } from "../symbols.js";
import type { SectorBoard, SectorRef, Symbol } from "../types.js";

const EM_HEADERS = { Referer: "https://quote.eastmoney.com/" };
const UT = "fa5fd1943c7b386f172d6893dbfba10b";

interface RawBoard {
  f12?: string; // code
  f14?: string; // name
  f3?: number; // pct *100
  f6?: number; // amount 元
  f104?: number; // up count
  f105?: number; // down count
  f128?: string; // leader name
  f136?: number; // leader pct *100
  f8?: number; // turnover *100
}

/**
 * Fetch industry (t:2) or concept (t:3) boards. Returns boards sorted by
 * pctChange desc with rank assigned. `available=false` everywhere on failure.
 */
export async function fetchEastMoneyBoards(
  type: "industry" | "concept"
): Promise<SectorBoard[]> {
  const t = type === "industry" ? 2 : 3;
  const fields = "f12,f14,f3,f6,f8,f104,f105,f128,f136";
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1` +
    `&fid=f3&fs=m:90+t:${t}&fields=${fields}&ut=${UT}`;
  const json = await fetchJson<any>(url, { headers: EM_HEADERS, timeoutMs: 9000 });
  const rows: RawBoard[] = json?.data?.diff ?? [];
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const sorted = rows
    .map((r) => ({ ...r, pct: toNum(r.f3) / 100 }))
    .sort((a, b) => b.pct - a.pct);
  const total = sorted.length;

  return sorted.map((r, i) => {
    const up = toNum(r.f104);
    const down = toNum(r.f105);
    const upRatio = up + down > 0 ? up / (up + down) : null;
    return {
      code: r.f12 ?? "",
      name: r.f14 ?? "",
      type,
      pctChange: r.pct,
      rank: i + 1,
      total,
      amount: toNum(r.f6),
      amountChangePct: null,
      upRatio,
      limitUpCount: null,
      leaderStrength: r.f136 != null ? toNum(r.f136) / 100 : null,
      score: 0, // filled by sector layer
      available: true,
    };
  });
}

export interface MarketBreadthRaw {
  advancers: number;
  decliners: number;
  unchanged: number;
  totalAmount: number;
  available: boolean;
}

/** Whole-market advancers/decliners by summing board member counts directly. */
export async function fetchEastMoneyBreadthCounts(): Promise<MarketBreadthRaw> {
  const fields = "f12,f14,f3,f6,f104,f105";
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=500&po=1&np=1` +
    `&fid=f3&fs=m:90+t:2&fields=${fields}&ut=${UT}`;
  const json = await fetchJson<any>(url, { headers: EM_HEADERS, timeoutMs: 9000 });
  const rows: RawBoard[] = json?.data?.diff ?? [];
  if (!Array.isArray(rows) || rows.length === 0)
    return { advancers: 0, decliners: 0, unchanged: 0, totalAmount: 0, available: false };
  let adv = 0;
  let dec = 0;
  let amount = 0;
  for (const r of rows) {
    adv += toNum(r.f104);
    dec += toNum(r.f105);
    amount += toNum(r.f6);
  }
  return { advancers: adv, decliners: dec, unchanged: 0, totalAmount: amount, available: true };
}

function ymd(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

export interface LimitCounts {
  limitUp: number;
  limitDown: number;
  available: boolean;
}

/** Limit-up / limit-down counts via the push2ex topic pools. */
export async function fetchEastMoneyLimitCounts(): Promise<LimitCounts> {
  const date = ymd();
  const ztUrl = `https://push2ex.eastmoney.com/getTopicZTPool?ut=${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${date}`;
  const dtUrl = `https://push2ex.eastmoney.com/getTopicDTPool?ut=${UT}&dpt=wz.dtzt&Pageindex=0&pagesize=1&sort=fund%3Aasc&date=${date}`;
  try {
    const [zt, dt] = await Promise.all([
      fetchJson<any>(ztUrl, { headers: EM_HEADERS, timeoutMs: 8000 }),
      fetchJson<any>(dtUrl, { headers: EM_HEADERS, timeoutMs: 8000 }),
    ]);
    const limitUp = toNum(zt?.data?.ct);
    const limitDown = toNum(dt?.data?.ct);
    return { limitUp, limitDown, available: zt?.data != null || dt?.data != null };
  } catch {
    return { limitUp: 0, limitDown: 0, available: false };
  }
}

export interface StockBoardBinding {
  industryName: string | null;
  concepts: SectorRef[];
  available: boolean;
}

/** Industry name + concept list for a single stock via the core stock API. */
export async function fetchEastMoneyStockBinding(
  symbol: Symbol
): Promise<StockBoardBinding> {
  const secid = toEastMoneySecid(symbol);
  const url =
    `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}` +
    `&fields=f57,f58,f127,f128,f129&ut=${UT}`;
  try {
    const json = await fetchJson<any>(url, { headers: EM_HEADERS, timeoutMs: 8000 });
    const d = json?.data;
    if (!d) return { industryName: null, concepts: [], available: false };
    const industryName: string | null = d.f127 || null;
    const concepts: SectorRef[] = [];
    // f128/f129 sometimes carry concept/region labels.
    for (const key of ["f128", "f129"]) {
      const v = d[key];
      if (typeof v === "string" && v && v !== "-") {
        concepts.push({ code: "", name: v, type: "concept" });
      }
    }
    return { industryName, concepts, available: true };
  } catch {
    return { industryName: null, concepts: [], available: false };
  }
}
