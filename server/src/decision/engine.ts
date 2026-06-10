import type {
  Decision,
  DecisionAction,
  DecisionCheck,
  ExitState,
  Layer1Metrics,
  MarketClock,
  Position,
  Quote,
  Regime,
  StockSectorInfo,
} from "../types.js";
import { clamp, round } from "../util/math.js";

export const DECISION_LABELS: Record<DecisionAction, string> = {
  strong_buy: "强买入信号",
  buy: "可考虑买入",
  watch: "观望",
  hold: "持有",
  reduce: "建议减仓",
  exit: "建议离场",
  avoid: "回避",
};

export interface DecisionInput {
  quote: Quote;
  layer1: Layer1Metrics;
  sector: StockSectorInfo | null;
  regime: Regime | null;
  position: Position | null;
  exit: ExitState | null;
  clock: MarketClock;
}

/** Volume quality 0..100: is the move backed by healthy participation? */
function volumeQuality(l: Layer1Metrics, amount: number): number {
  let q = 50;
  const rv = l.relativeVolume;
  if (rv >= 1.2) q += Math.min((rv - 1.2) / 2.8, 1) * 30; // 放量, saturates at 4x
  else if (rv > 0 && rv < 0.9) q -= ((0.9 - rv) / 0.9) * 25; // 缩量
  if (rv > 8) q -= 15; // 异常爆量：分歧巨大

  if (l.turnoverRate >= 3 && l.turnoverRate <= 15) q += 10;
  else if (l.turnoverRate > 25) q -= 10; // 过度换手
  else if (l.turnoverRate > 0 && l.turnoverRate < 1) q -= 10; // 死水

  if (amount >= 5e8) q += 5;
  else if (amount > 0 && amount < 1e8) q -= 15;

  if (l.volTrend != null && l.volTrend >= 1.2 && l.pctChange > 0) q += 5;
  return clamp(round(q, 1), 0, 100);
}

function industryRankPctile(sector: StockSectorInfo | null): number | null {
  const ind = sector?.industry;
  if (!ind || ind.total <= 0) return null;
  return ind.rank / ind.total; // 0 = strongest
}

function buildChecklist(input: DecisionInput): DecisionCheck[] {
  const { layer1: l, sector, regime, quote } = input;
  const checks: DecisionCheck[] = [];

  checks.push({
    key: "daily_trend",
    label: "日线趋势向好",
    pass: l.dailyScore == null ? null : l.dailyScore >= 55,
    detail:
      l.dailyScore == null
        ? "历史K线不足"
        : `日线分 ${l.dailyScore}（≥55 通过）`,
  });

  const intradayOk = l.intradayScore >= 58 && l.priceVsVwap > 0;
  checks.push({
    key: "intraday",
    label: "日内强势(站上VWAP)",
    pass: intradayOk,
    detail: `日内分 ${l.intradayScore}，价对VWAP ${l.priceVsVwap > 0 ? "+" : ""}${l.priceVsVwap}%`,
  });

  checks.push({
    key: "volume",
    label: "放量配合",
    pass: l.relativeVolume > 0 ? l.relativeVolume >= 1.3 : null,
    detail: l.relativeVolume > 0 ? `量比 ${l.relativeVolume}（≥1.3 通过）` : "量比不可用",
  });

  const rankP = industryRankPctile(sector);
  const sectorPass =
    sector?.available === true
      ? sector.sectorScore >= 55 || (rankP != null && rankP <= 0.3)
      : null;
  checks.push({
    key: "sector",
    label: "板块走强",
    pass: sectorPass,
    detail: sector?.available
      ? `板块分 ${sector.sectorScore}${sector.industry ? `，行业排名 ${sector.industry.rank}/${sector.industry.total}` : ""}`
      : "板块数据不可用",
  });

  const regimePass =
    regime != null ? regime.score >= -10 && regime.kind !== "panic" && regime.kind !== "weak" : null;
  checks.push({
    key: "regime",
    label: "大盘环境配合",
    pass: regimePass,
    detail: regime ? `${regime.label}，强弱分 ${regime.score}` : "大盘状态不可用",
  });

  const notChasing =
    l.pctChange <= 7 &&
    l.priceVsVwap <= 4 &&
    (l.rsi14 == null || l.rsi14 <= 78) &&
    (l.distanceToLimitUp <= 0 || l.distanceToLimitUp > 1.5);
  checks.push({
    key: "not_chasing",
    label: "非追高位置",
    pass: notChasing,
    detail: `今日 ${l.pctChange > 0 ? "+" : ""}${l.pctChange}%，VWAP偏离 ${l.priceVsVwap}%${l.rsi14 != null ? `，RSI ${l.rsi14}` : ""}`,
  });

  const liquid = quote.amount >= 1.5e8 && (l.bidAskSpread <= 0.2 || l.bidAskSpread === 0);
  checks.push({
    key: "liquidity",
    label: "流动性充足",
    pass: liquid,
    detail: `成交额 ${(quote.amount / 1e8).toFixed(1)}亿，价差 ${l.bidAskSpread}%`,
  });

  return checks;
}

function suggestedStop(l: Layer1Metrics): { pct: number; price: number } | null {
  if (l.price <= 0) return null;
  // 1.8 × ATR, bounded to 2%..6%: tight enough to protect, wide enough to survive noise
  const atrFrac = l.atrPct != null ? l.atrPct / 100 : 0.025;
  const pct = clamp(1.8 * atrFrac, 0.02, 0.06);
  return { pct: round(pct, 4), price: round(l.price * (1 - pct), 3) };
}

function entryTimingHint(input: DecisionInput, checks: DecisionCheck[]): string | null {
  const { clock, layer1: l } = input;
  if (!clock.open) return "当前为非交易时段，信号供下一交易日开盘后参考";

  const sh = new Date(clock.serverTime).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
  });
  const [hh, mm] = sh.split(":").map(Number);
  const minute = hh * 60 + mm;

  if (minute < 10 * 60) return "开盘前30分钟波动大、量比未稳定，宜等10:00后确认再进场";
  if (minute >= 14 * 60 + 45) return "临近收盘：日内策略不宜新开仓，隔日策略可在确认强势收盘后考虑";

  const intraday = checks.find((c) => c.key === "intraday");
  if (intraday?.pass === false && l.dailyScore != null && l.dailyScore >= 55) {
    return "日线趋势好但日内偏弱：等待回踩VWAP/均线企稳，或重新放量站上VWAP再进";
  }
  const chasing = checks.find((c) => c.key === "not_chasing");
  if (chasing?.pass === false) {
    return "短线位置偏高：勿追，等回踩VWAP附近缩量企稳再考虑";
  }
  if (checks.filter((c) => c.pass === true).length >= 5) {
    return "条件基本齐备：回踩VWAP不破、或放量突破日内高点时为较好进场点";
  }
  return null;
}

export function computeDecision(input: DecisionInput): Decision {
  const { quote, layer1: l, sector, regime, position, exit, clock } = input;
  const reasons: string[] = [];
  const warnings: string[] = [];
  const checks = buildChecklist(input);

  // ---- composite opportunity score ----
  const daily = l.dailyScore;
  const intraday = l.intradayScore;
  const sectorScore = sector?.available
    ? Math.max(sector.sectorScore, sector.conceptScore ?? 0)
    : null;
  const regimeNorm = regime ? (regime.score + 100) / 2 : null;
  const volQ = volumeQuality(l, quote.amount);

  const parts: { v: number | null; w: number }[] = [
    { v: daily, w: 0.3 },
    { v: intraday, w: 0.25 },
    { v: sectorScore, w: 0.2 },
    { v: regimeNorm, w: 0.15 },
    { v: volQ, w: 0.1 },
  ];
  let sum = 0;
  let wsum = 0;
  for (const p of parts) {
    if (p.v == null) continue;
    sum += p.v * p.w;
    wsum += p.w;
  }
  let score = wsum > 0 ? clamp(round(sum / wsum, 1), 0, 100) : 50;

  // ---- confidence: data completeness + component agreement ----
  const availFrac = wsum; // weights are fractions of 1
  const known = parts.filter((p) => p.v != null).map((p) => p.v!) as number[];
  const spread = known.length >= 2 ? Math.max(...known) - Math.min(...known) : 0;
  let confidence = clamp(availFrac * 100 - (spread > 40 ? 15 : spread > 25 ? 8 : 0), 0, 100);
  if (quote.stale) confidence = Math.min(confidence, 40);
  confidence = round(confidence, 0);

  // ---- evidence ----
  if (daily != null && daily >= 60) reasons.push(`日线趋势健康（日线分 ${daily}）`);
  if (daily != null && daily < 45) warnings.push(`日线趋势偏弱（日线分 ${daily}）`);
  if (intraday >= 62) reasons.push(`日内走强（日内分 ${intraday}，VWAP上方 ${l.priceVsVwap}%）`);
  if (intraday <= 38) warnings.push(`日内走弱（日内分 ${intraday}）`);
  if (l.relativeVolume >= 1.5) reasons.push(`明显放量（量比 ${l.relativeVolume}）`);
  if (sectorScore != null && sectorScore >= 60)
    reasons.push(`所属板块强势（板块分 ${sectorScore}）`);
  if (sectorScore != null && sectorScore < 40) warnings.push(`所属板块弱势（板块分 ${sectorScore}）`);
  if (l.distToHigh20 != null && l.distToHigh20 <= 0) reasons.push("已突破20日新高");
  if (l.macdHist != null && l.macdHistPrev != null && l.macdHist > 0 && l.macdHist > l.macdHistPrev)
    reasons.push("MACD红柱放大");
  if (l.macdHist != null && l.macdHistPrev != null && l.macdHist < 0 && l.macdHist < l.macdHistPrev)
    warnings.push("MACD绿柱放大");

  // ---- risk flags / hard gates ----
  let capAction: DecisionAction | null = null; // strongest buy-side action allowed
  let fatal = false;

  if (quote.name.toUpperCase().includes("ST")) warnings.push("ST/风险警示股，涨跌幅5%且退市风险高");
  if (daily == null) warnings.push("历史K线不足（次新/数据缺失），日线层不可用");
  if (l.pctChange <= -6) {
    fatal = true;
    warnings.push(`今日重挫 ${l.pctChange}%，落刀勿接`);
  }
  if (daily != null && daily < 40 && l.ma20 != null && l.price < l.ma20) {
    fatal = true;
    warnings.push("处于日线空头结构（20日线下方且日线分<40），不做左侧");
  }
  if (l.distanceToLimitUp > 0 && l.distanceToLimitUp <= 1) {
    capAction = "watch";
    warnings.push("已临近涨停，盘中追入滑点与开板风险大");
  }
  if (l.pctChange > 7 || l.priceVsVwap > 4 || (l.rsi14 != null && l.rsi14 > 80)) {
    if (capAction == null) capAction = "buy";
    warnings.push("短线超买/追高风险（涨幅、VWAP偏离或RSI过高）");
  }
  if (quote.amount > 0 && quote.amount < 1e8) warnings.push("成交额不足1亿，流动性差、滑点高");
  if (l.bidAskSpread > 0.3) warnings.push(`买卖价差 ${l.bidAskSpread}% 偏大`);

  if (regime) {
    if (regime.kind === "panic") {
      capAction = "watch";
      score = Math.min(score, 45);
      warnings.push("恐慌杀跌市：系统性风险优先，不抄底、不开新仓");
    } else if (regime.kind === "weak") {
      warnings.push("弱势市：仅极强信号可少量参与，降低仓位预期");
    } else if (regime.kind === "low_volume") {
      warnings.push("缩量无方向市：突破假信号多，观望为主");
    } else if (regime.kind === "theme" && sectorScore != null && sectorScore < 50) {
      warnings.push("题材情绪市但本股板块不在风口，资金或被虹吸");
    }
  }
  if (quote.stale) warnings.push("行情数据延迟/已收盘，结论仅供参考");

  const stop = suggestedStop(l);

  // ---- action selection ----
  let action: DecisionAction;

  if (position && exit) {
    // ---- holder mode ----
    if (exit.kind === "stop_loss_warn") {
      action = "exit";
      reasons.unshift(`已触发止损线 ${exit.stopLossPrice}（亏损 ${exit.pnlPct}%），纪律优先`);
    } else if (exit.kind === "take_profit_warn") {
      const deteriorating = intraday < 45 || l.trendTag === "bear";
      action = deteriorating ? "exit" : "reduce";
      reasons.unshift(
        `自高点 ${exit.peak} 回撤触发止盈提醒${deteriorating ? "，且日内走弱，建议落袋" : "，可分批止盈"}`
      );
    } else if (exit.kind === "stop_loss_watch") {
      action = "hold";
      warnings.unshift(`已跌破成本，止损线 ${exit.stopLossPrice}，跌破坚决执行`);
    } else {
      const deterioration = [
        intraday < 40,
        l.priceVsVwap < -1,
        daily != null && daily < 45,
        sectorScore != null && sectorScore < 40,
        l.intradayMomentum15 < -1.5,
      ].filter(Boolean).length;
      if (deterioration >= 3) {
        action = "reduce";
        warnings.unshift("多项指标转弱（日内/板块/动量），建议先减仓锁定利润");
      } else {
        action = "hold";
        if (exit.pnlPct > 0) reasons.unshift(`浮盈 ${exit.pnlPct}%，趋势未破坏，按跟踪止盈持有`);
      }
    }
  } else {
    // ---- entry mode ----
    const corePass = checks.slice(0, 5).filter((c) => c.pass === true).length;
    if (fatal) {
      action = "avoid";
    } else if (score >= 75 && corePass >= 4) {
      action = "strong_buy";
    } else if (score >= 65 && corePass >= 3) {
      action = "buy";
    } else if (score >= 45) {
      action = "watch";
    } else {
      action = "avoid";
    }
    // regime/extension caps
    if (capAction) {
      const order: DecisionAction[] = ["avoid", "watch", "buy", "strong_buy"];
      if (order.indexOf(action) > order.indexOf(capAction)) action = capAction;
    }
    if (regime?.kind === "weak" && (action === "buy" || action === "strong_buy") && score < 75) {
      action = "watch";
    }
    if (!clock.open && (action === "buy" || action === "strong_buy")) {
      // off-session signals are for next-day planning, not immediate execution
      warnings.push("非交易时段：以下为次日计划参考");
    }
  }

  return {
    action,
    label: DECISION_LABELS[action],
    score,
    confidence,
    reasons: reasons.slice(0, 6),
    warnings: warnings.slice(0, 6),
    checklist: checks,
    suggestedStopPct: stop?.pct ?? null,
    suggestedStopPrice: stop?.price ?? null,
    entryHint: position ? null : entryTimingHint(input, checks),
    ts: Date.now(),
  };
}
