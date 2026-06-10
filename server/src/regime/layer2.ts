import type { Breadth, IndexSnapshot, Quote, Regime, RegimeKind, Symbol } from "../types.js";
import { fetchDaily, fetchQuotes } from "../providers/index.js";
import {
  fetchEastMoneyBreadthCounts,
  fetchEastMoneyLimitCounts,
  fetchEastMoneyZTPool,
  fetchPrevDayMarketAmount,
} from "../providers/eastmoney.js";
import { tushareLimitCounts } from "../providers/tushare.js";
import { getMarketClock, sessionVolumeFraction } from "../marketClock.js";
import { clamp, mean, round, sma } from "../util/math.js";

export const INDEX_SYMBOLS: { symbol: Symbol; name: string }[] = [
  { symbol: "sh000001", name: "上证指数" },
  { symbol: "sh000300", name: "沪深300" },
  { symbol: "sh000905", name: "中证500" },
  { symbol: "sz399006", name: "创业板指" },
  { symbol: "sh000688", name: "科创50" },
];

export const REGIME_LABELS: Record<RegimeKind, string> = {
  strong_trend: "强趋势市",
  range: "震荡市",
  weak: "弱势市",
  theme: "题材情绪市",
  panic: "恐慌杀跌市",
  low_volume: "缩量无方向市",
};

// ---- index daily MA20 cache (medium-term trend health) ----

const indexMaCache = new Map<Symbol, { ts: number; ma20: number | null }>();
const INDEX_MA_TTL = 10 * 60 * 1000;

async function indexMa20(symbol: Symbol): Promise<number | null> {
  const cur = indexMaCache.get(symbol);
  if (cur && Date.now() - cur.ts < INDEX_MA_TTL) return cur.ma20;
  try {
    const bars = await fetchDaily(symbol, 30);
    // exclude today's running bar so the MA is stable intraday
    const closes = bars.slice(0, -1).map((b) => b.close).filter((c) => c > 0);
    const ma20 = sma(closes, 20);
    indexMaCache.set(symbol, { ts: Date.now(), ma20 });
    return ma20;
  } catch {
    indexMaCache.set(symbol, { ts: Date.now(), ma20: cur?.ma20 ?? null });
    return cur?.ma20 ?? null;
  }
}

function toIndexSnapshot(name: string, q: Quote, ma20: number | null): IndexSnapshot {
  const vwap = q.avgPrice > 0 ? q.avgPrice : q.price;
  const drawdown = q.high > 0 ? ((q.high - q.price) / q.high) * 100 : 0;
  return {
    symbol: q.symbol,
    name,
    price: round(q.price, 2),
    pctChange: round(q.prevClose > 0 ? ((q.price - q.prevClose) / q.prevClose) * 100 : 0, 2),
    amount: q.amount,
    aboveVwap: q.price >= vwap,
    aboveMa20: ma20 != null && ma20 > 0 ? q.price >= ma20 : null,
    intradayDrawdown: round(drawdown, 2),
  };
}

export async function buildIndexSnapshots(quotes: Map<Symbol, Quote>): Promise<IndexSnapshot[]> {
  const out: IndexSnapshot[] = [];
  for (const { symbol, name } of INDEX_SYMBOLS) {
    const q = quotes.get(symbol);
    if (!q) continue;
    const ma20 = await indexMa20(symbol).catch(() => null);
    out.push(toIndexSnapshot(name, q, ma20));
  }
  return out;
}

/**
 * Composite regime strength −100..100 plus a discrete regime kind.
 *
 *  score = 指数动量(±60) + 广度(±40) + VWAP上方占比(±20) + 涨跌停差(±20)
 *        + MA20上方占比(±16) + 量能变化(±8)
 */
export function classifyRegime(
  indices: IndexSnapshot[],
  breadth: Breadth
): { kind: RegimeKind; score: number; reasons: string[] } {
  const reasons: string[] = [];
  const avgPct = indices.length ? mean(indices.map((i) => i.pctChange)) : 0;
  const aboveVwapCount = indices.filter((i) => i.aboveVwap).length;
  const maxDrawdown = indices.length ? Math.max(...indices.map((i) => i.intradayDrawdown)) : 0;
  const maKnown = indices.filter((i) => i.aboveMa20 != null);
  const aboveMa20Count = maKnown.filter((i) => i.aboveMa20).length;

  const total = breadth.advancers + breadth.decliners;
  const breadthRatio = breadth.available && total > 0 ? breadth.advancers / total : null;

  let score = clamp(avgPct, -5, 5) * 12; // index momentum
  if (breadthRatio != null) score += (breadthRatio - 0.5) * 80;
  score += clamp((aboveVwapCount - indices.length / 2) * 10, -20, 20);
  if (breadth.available) score += clamp((breadth.limitUp - breadth.limitDown) * 0.3, -20, 20);
  if (maKnown.length > 0)
    score += clamp((aboveMa20Count - maKnown.length / 2) * 8, -16, 16);
  if (breadth.amountChangePct != null)
    score += clamp(breadth.amountChangePct / 15, -1, 1) * 8;
  score = round(clamp(score, -100, 100), 1);

  reasons.push(`指数均涨幅 ${avgPct.toFixed(2)}%`);
  reasons.push(`${aboveVwapCount}/${indices.length} 指数在均价上方`);
  if (maKnown.length > 0)
    reasons.push(`${aboveMa20Count}/${maKnown.length} 指数在20日线上方`);
  if (breadthRatio != null)
    reasons.push(
      `涨跌家数 ${breadth.advancers}/${breadth.decliners} (${(breadthRatio * 100).toFixed(0)}% 上涨)`
    );
  if (breadth.available) {
    reasons.push(
      `涨停 ${breadth.limitUp} / 跌停 ${breadth.limitDown}` +
        (breadth.maxLimitStreak != null && breadth.maxLimitStreak >= 2
          ? `，最高连板 ${breadth.maxLimitStreak}`
          : "")
    );
  }
  if (breadth.amountChangePct != null)
    reasons.push(
      `两市成交额(按时段折算)较昨日 ${breadth.amountChangePct > 0 ? "+" : ""}${breadth.amountChangePct.toFixed(1)}%`
    );

  let kind: RegimeKind;
  const hotLimits =
    breadth.available &&
    breadth.limitUp >= 60 &&
    breadth.limitUp >= breadth.limitDown * 3 &&
    (breadth.maxLimitStreak == null || breadth.maxLimitStreak >= 3);
  const panic =
    avgPct <= -1.5 &&
    ((breadthRatio != null && breadthRatio < 0.3) ||
      (breadth.available && breadth.limitDown >= 20 && breadth.limitDown > breadth.limitUp));

  if (panic) {
    kind = "panic";
    reasons.unshift("指数重挫且个股普跌");
  } else if (hotLimits) {
    kind = "theme";
    reasons.unshift("涨停家数显著放大、连板有高度，资金情绪活跃");
  } else if (
    avgPct >= 1.0 &&
    (breadthRatio == null || breadthRatio > 0.6) &&
    aboveVwapCount >= Math.ceil(indices.length * 0.8)
  ) {
    kind = "strong_trend";
    reasons.unshift("指数普涨、个股广度强、站上均价");
  } else if (avgPct <= -0.6 && (breadthRatio == null || breadthRatio < 0.45)) {
    kind = "weak";
    reasons.unshift("指数走弱、做多广度不足");
  } else if (
    Math.abs(avgPct) < 0.4 &&
    (breadthRatio == null || (breadthRatio > 0.42 && breadthRatio < 0.58))
  ) {
    if (breadth.amountChangePct != null && breadth.amountChangePct < -12) {
      kind = "low_volume";
      reasons.unshift("成交额明显萎缩、方向不明");
    } else {
      kind = "range";
      reasons.unshift("指数横盘、多空均衡");
    }
  } else {
    kind = "range";
    reasons.unshift("多空交织，区间震荡");
  }

  if (maxDrawdown >= 1.5) reasons.push(`指数日内最大回撤 ${maxDrawdown.toFixed(2)}%`);
  return { kind, score, reasons };
}

export async function fetchRegime(): Promise<Regime> {
  const quotes = await fetchQuotes(INDEX_SYMBOLS.map((i) => i.symbol)).catch(
    () => new Map<Symbol, Quote>()
  );
  const indices = await buildIndexSnapshots(quotes);

  let breadth: Breadth = {
    advancers: 0,
    decliners: 0,
    unchanged: 0,
    limitUp: 0,
    limitDown: 0,
    maxLimitStreak: null,
    totalAmount: indices.reduce((a, i) => a + i.amount, 0),
    amountChangePct: null,
    available: false,
  };

  try {
    const [counts, limitsRaw, ztPool, prevAmount] = await Promise.all([
      fetchEastMoneyBreadthCounts(),
      fetchEastMoneyLimitCounts(),
      fetchEastMoneyZTPool(),
      fetchPrevDayMarketAmount(),
    ]);
    let limits = limitsRaw;
    if (!limits.available) {
      const ts = await tushareLimitCounts();
      if (ts.available) limits = ts;
    }

    if (counts.available) {
      breadth = {
        advancers: counts.advancers,
        decliners: counts.decliners,
        unchanged: counts.unchanged,
        limitUp: limits.available ? limits.limitUp : ztPool.available ? ztPool.count : 0,
        limitDown: limits.available ? limits.limitDown : 0,
        maxLimitStreak: ztPool.available ? ztPool.maxStreak : null,
        totalAmount: counts.totalAmount,
        amountChangePct: null,
        available: true,
      };
    } else if (limits.available) {
      breadth.limitUp = limits.limitUp;
      breadth.limitDown = limits.limitDown;
      breadth.maxLimitStreak = ztPool.available ? ztPool.maxStreak : null;
    }

    // projected full-day amount vs yesterday (time-of-day adjusted)
    if (prevAmount != null && prevAmount > 0 && breadth.totalAmount > 0) {
      const clock = getMarketClock();
      const frac = clock.session === "closed" ? 1 : sessionVolumeFraction();
      if (frac >= 0.05) {
        const projected = breadth.totalAmount / frac;
        breadth.amountChangePct = round((projected / prevAmount - 1) * 100, 1);
      }
    }
  } catch {
    // keep degraded breadth
  }

  const { kind, score, reasons } = classifyRegime(indices, breadth);
  return {
    kind,
    label: REGIME_LABELS[kind],
    score,
    indices,
    breadth,
    reasons,
    ts: Date.now(),
  };
}
