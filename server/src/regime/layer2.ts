import type { Breadth, IndexSnapshot, Quote, Regime, RegimeKind, Symbol } from "../types.js";
import { fetchQuotes } from "../providers/index.js";
import {
  fetchEastMoneyBreadthCounts,
  fetchEastMoneyLimitCounts,
} from "../providers/eastmoney.js";
import { tushareLimitCounts } from "../providers/tushare.js";
import { clamp, mean, round } from "../util/math.js";

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

function toIndexSnapshot(name: string, q: Quote): IndexSnapshot {
  const vwap = q.avgPrice > 0 ? q.avgPrice : q.price;
  const drawdown = q.high > 0 ? ((q.high - q.price) / q.high) * 100 : 0;
  return {
    symbol: q.symbol,
    name,
    price: round(q.price, 2),
    pctChange: round(
      q.prevClose > 0 ? ((q.price - q.prevClose) / q.prevClose) * 100 : 0,
      2
    ),
    amount: q.amount,
    aboveVwap: q.price >= vwap,
    intradayDrawdown: round(drawdown, 2),
  };
}

export function buildIndexSnapshots(quotes: Map<Symbol, Quote>): IndexSnapshot[] {
  const out: IndexSnapshot[] = [];
  for (const { symbol, name } of INDEX_SYMBOLS) {
    const q = quotes.get(symbol);
    if (q) out.push(toIndexSnapshot(name, q));
  }
  return out;
}

export function classifyRegime(
  indices: IndexSnapshot[],
  breadth: Breadth
): { kind: RegimeKind; score: number; reasons: string[] } {
  const reasons: string[] = [];
  const avgPct = indices.length ? mean(indices.map((i) => i.pctChange)) : 0;
  const aboveVwapCount = indices.filter((i) => i.aboveVwap).length;
  const maxDrawdown = indices.length ? Math.max(...indices.map((i) => i.intradayDrawdown)) : 0;

  const total = breadth.advancers + breadth.decliners;
  const breadthRatio = breadth.available && total > 0 ? breadth.advancers / total : null;

  // composite strength score -100..100
  let score = clamp(avgPct, -5, 5) * 12; // index momentum
  if (breadthRatio != null) score += (breadthRatio - 0.5) * 80;
  score += clamp((aboveVwapCount - indices.length / 2) * 10, -20, 20);
  if (breadth.available) score += clamp((breadth.limitUp - breadth.limitDown) * 0.3, -20, 20);
  score = round(clamp(score, -100, 100), 1);

  reasons.push(`指数均涨幅 ${avgPct.toFixed(2)}%`);
  reasons.push(`${aboveVwapCount}/${indices.length} 指数在均价上方`);
  if (breadthRatio != null)
    reasons.push(`涨跌家数 ${breadth.advancers}/${breadth.decliners} (${(breadthRatio * 100).toFixed(0)}% 上涨)`);
  if (breadth.available) reasons.push(`涨停 ${breadth.limitUp} / 跌停 ${breadth.limitDown}`);

  let kind: RegimeKind;
  const hotLimits = breadth.available && breadth.limitUp >= 60 && breadth.limitUp >= breadth.limitDown * 3;
  const panic =
    avgPct <= -1.5 &&
    ((breadthRatio != null && breadthRatio < 0.3) ||
      (breadth.available && breadth.limitDown >= 20 && breadth.limitDown > breadth.limitUp)) ;

  if (panic) {
    kind = "panic";
    reasons.unshift("指数重挫且个股普跌");
  } else if (hotLimits) {
    kind = "theme";
    reasons.unshift("涨停家数显著放大，资金情绪活跃");
  } else if (avgPct >= 1.0 && (breadthRatio == null || breadthRatio > 0.6) && aboveVwapCount >= Math.ceil(indices.length * 0.8)) {
    kind = "strong_trend";
    reasons.unshift("指数普涨、个股广度强、站上均价");
  } else if (avgPct <= -0.6 && (breadthRatio == null || breadthRatio < 0.45)) {
    kind = "weak";
    reasons.unshift("指数走弱、做多广度不足");
  } else if (Math.abs(avgPct) < 0.4 && (breadthRatio == null || (breadthRatio > 0.42 && breadthRatio < 0.58))) {
    // distinguish low-volume from range when we know amount shrank
    if (breadth.amountChangePct != null && breadth.amountChangePct < -8) {
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
  const indices = buildIndexSnapshots(quotes);

  let breadth: Breadth = {
    advancers: 0,
    decliners: 0,
    unchanged: 0,
    limitUp: 0,
    limitDown: 0,
    totalAmount: indices.reduce((a, i) => a + i.amount, 0),
    amountChangePct: null,
    available: false,
  };
  try {
    let [counts, limits] = await Promise.all([
      fetchEastMoneyBreadthCounts(),
      fetchEastMoneyLimitCounts(),
    ]);
    if (!limits.available) {
      const ts = await tushareLimitCounts();
      if (ts.available) limits = ts;
    }
    if (counts.available) {
      breadth = {
        advancers: counts.advancers,
        decliners: counts.decliners,
        unchanged: counts.unchanged,
        limitUp: limits.available ? limits.limitUp : 0,
        limitDown: limits.available ? limits.limitDown : 0,
        totalAmount: counts.totalAmount,
        amountChangePct: null,
        available: true,
      };
    } else if (limits.available) {
      breadth.limitUp = limits.limitUp;
      breadth.limitDown = limits.limitDown;
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
