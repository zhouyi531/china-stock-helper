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
      limitUpCount: null, // injected from the 涨停池 by the sector layer
      maxLimitStreak: null,
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

/** Date in the Asia/Shanghai timezone as yyyymmdd (trading-day key). */
function ymd(d = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d).replace(/-/g, "");
}

/** Date in the Asia/Shanghai timezone as yyyy-mm-dd (matches kline dates). */
export function shanghaiDateIso(d = new Date()): string {
  const s = ymd(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
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

// ---- Limit-up pool (涨停池) with industry binding & 连板 height ----

export interface ZTPoolItem {
  code: string;
  name: string;
  /** 行业板块 name, matches industry board names */
  industry: string | null;
  /** 连板数 (1 = 首板) */
  streak: number;
}

export interface ZTPool {
  count: number;
  items: ZTPoolItem[];
  /** highest 连板 height in the pool */
  maxStreak: number;
  available: boolean;
  ts: number;
}

let ztPoolCache: ZTPool | null = null;
const ZT_POOL_TTL = 20_000;

/**
 * Full limit-up pool: every 涨停 stock with its industry & 连板 height.
 * Feeds per-board limit-up counts (Layer 3) and theme temperature (Layer 2).
 * Cached briefly because both the regime and sector loops want it.
 */
export async function fetchEastMoneyZTPool(): Promise<ZTPool> {
  if (ztPoolCache && Date.now() - ztPoolCache.ts < ZT_POOL_TTL) return ztPoolCache;
  const url =
    `https://push2ex.eastmoney.com/getTopicZTPool?ut=${UT}&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=600&sort=fbt%3Aasc&date=${ymd()}`;
  try {
    const json = await fetchJson<any>(url, { headers: EM_HEADERS, timeoutMs: 9000 });
    const pool: any[] = json?.data?.pool ?? [];
    const items: ZTPoolItem[] = pool.map((p) => ({
      // numeric codes lose leading zeros (e.g. 2415 -> "002415")
      code: String(p?.c ?? "").padStart(6, "0"),
      name: String(p?.n ?? ""),
      industry: typeof p?.hybk === "string" && p.hybk ? p.hybk : null,
      streak: Math.max(1, toNum(p?.lbc)),
    }));
    const out: ZTPool = {
      count: toNum(json?.data?.ct) || items.length,
      items,
      maxStreak: items.reduce((a, i) => Math.max(a, i.streak), 0),
      available: json?.data != null,
      ts: Date.now(),
    };
    if (out.available) ztPoolCache = out;
    return out;
  } catch {
    return ztPoolCache ?? { count: 0, items: [], maxStreak: 0, available: false, ts: Date.now() };
  }
}

// ---- Whole-market amount history (for 成交额 vs 昨日) ----

interface IndexAmountCache {
  /** total SH+SZ amount of the most recent COMPLETED trading day, 元 */
  prevDayAmount: number;
  ts: number;
}
let indexAmountCache: IndexAmountCache | null = null;
const INDEX_AMOUNT_TTL = 10 * 60 * 1000;

async function fetchIndexDailyAmounts(secid: string): Promise<{ date: string; amount: number }[]> {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}` +
    `&klt=101&fqt=0&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f56,f57&end=20500101&lmt=6&ut=${UT}`;
  const json = await fetchJson<any>(url, { headers: EM_HEADERS, timeoutMs: 9000 });
  const klines: string[] = json?.data?.klines ?? [];
  return klines.map((k) => {
    const seg = k.split(",");
    return { date: seg[0] ?? "", amount: toNum(seg[2]) };
  });
}

/**
 * Yesterday's total two-market turnover (上证综指 covers all SH, 深证综指 all SZ).
 * Used to compute today's projected amount change. Cached 10 minutes.
 */
export async function fetchPrevDayMarketAmount(): Promise<number | null> {
  if (indexAmountCache && Date.now() - indexAmountCache.ts < INDEX_AMOUNT_TTL) {
    return indexAmountCache.prevDayAmount;
  }
  try {
    const [sh, sz] = await Promise.all([
      fetchIndexDailyAmounts("1.000001"), // 上证综指
      fetchIndexDailyAmounts("0.399106"), // 深证综指
    ]);
    const today = shanghaiDateIso();
    const prevOf = (rows: { date: string; amount: number }[]): number => {
      const completed = rows.filter((r) => r.date !== today && r.amount > 0);
      return completed.length ? completed[completed.length - 1].amount : 0;
    };
    const total = prevOf(sh) + prevOf(sz);
    if (total <= 0) return null;
    indexAmountCache = { prevDayAmount: total, ts: Date.now() };
    return total;
  } catch {
    return indexAmountCache?.prevDayAmount ?? null;
  }
}

// ---- Whole-market stock list (for the scanner) ----

export interface ScannerRow {
  symbol: Symbol;
  code: string;
  name: string;
  price: number;
  pctChange: number; // %
  volume: number; // 手
  amount: number; // 元
  turnoverRate: number; // %
  volumeRatio: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  /** 涨速 % over the last few minutes */
  speedPct: number;
  industry: string | null;
}

interface RawScanRow {
  f12?: string; // code
  f13?: number; // market: 1=sh 0=sz
  f14?: string; // name
  f2?: number; // price
  f3?: number; // pct %
  f5?: number; // volume 手
  f6?: number; // amount 元
  f8?: number; // turnover %
  f10?: number; // 量比
  f15?: number; // high
  f16?: number; // low
  f17?: number; // open
  f18?: number; // prevClose
  f22?: number; // 涨速 %
  f100?: string; // industry name
}

const SCAN_FIELDS = "f12,f13,f14,f2,f3,f5,f6,f8,f10,f15,f16,f17,f18,f22,f100";
/** 沪主板 + 科创板 + 深主板 + 创业板 (no BJ — illiquid for this tool's style) */
const SCAN_FS = "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23";

async function fetchScanPage(fid: string, pz: number): Promise<RawScanRow[]> {
  const url =
    `https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=${pz}&po=1&np=1&fltt=2` +
    `&fid=${fid}&fs=${SCAN_FS}&fields=${SCAN_FIELDS}&ut=${UT}`;
  const json = await fetchJson<any>(url, { headers: EM_HEADERS, timeoutMs: 10000 });
  const rows: RawScanRow[] = json?.data?.diff ?? [];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Active universe for the scanner: top 500 by amount (liquidity core) merged
 * with top 300 by % change (momentum tail). Two requests, ~700 unique rows.
 */
export async function fetchEastMoneyScanUniverse(): Promise<ScannerRow[]> {
  const [byAmount, byPct] = await Promise.all([
    fetchScanPage("f6", 500),
    fetchScanPage("f3", 300),
  ]);
  const seen = new Set<string>();
  const out: ScannerRow[] = [];
  for (const r of [...byAmount, ...byPct]) {
    const code = r.f12 ?? "";
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const market = r.f13 === 1 ? "sh" : "sz";
    const price = toNum(r.f2);
    if (price <= 0) continue;
    out.push({
      symbol: `${market}${code}`,
      code,
      name: r.f14 ?? "",
      price,
      pctChange: toNum(r.f3),
      volume: toNum(r.f5),
      amount: toNum(r.f6),
      turnoverRate: toNum(r.f8),
      volumeRatio: toNum(r.f10),
      high: toNum(r.f15),
      low: toNum(r.f16),
      open: toNum(r.f17),
      prevClose: toNum(r.f18),
      speedPct: toNum(r.f22),
      industry: typeof r.f100 === "string" && r.f100 ? r.f100 : null,
    });
  }
  return out;
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
