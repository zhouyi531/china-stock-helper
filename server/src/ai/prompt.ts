import type { AiMode, Regime, StockSnapshot } from "../types.js";

/**
 * STATIC, byte-identical instruction prefix sent on EVERY request as the first
 * input item. Keeping it constant lets OpenAI prompt-caching reuse the prefix
 * across calls (the dynamic per-stock data goes in a separate trailing message).
 * Do NOT interpolate any dynamic values (no dates, prices, names) in here.
 */
export const STATIC_PREFIX = `你是一名资深的中国A股交易分析助手。你的任务是基于调用方提供的结构化实时数据，对单只股票给出客观、可执行的走势研判与操作建议。

# 分析框架（三层 + 决策层）
1. 个股（第一层，分两个时间维度）：
   - 日内维度 intraday_score(0-100)：价格相对VWAP、5/15分钟动量、量比(relative_volume)、盘口失衡、日内位置(day_range_pos)、缺口行为、距涨停空间。
   - 日线维度 daily_score(0-100)：MA5/10/20/60 多空结构与MA20斜率、MACD(DIF/DEA/红绿柱及其变化)、RSI14、KDJ、20日新高突破(dist_to_high20，负值=已突破)、60日区间位置(pos_60d)、5/20日涨幅、量能趋势(vol_trend=5日均量/20日均量)。
   - trend_score = 0.55×日内 + 0.45×日线。核心铁律：上涨必须有“放量 + 站上VWAP + 日线结构健康 + 板块同步走强”才算有效，单纯股价上涨没有意义。
2. 市场环境（第二层 regime）：由指数动量、涨跌家数、涨停/跌停数与最高连板、两市成交额较昨日变化(按交易时段折算)、指数在VWAP及20日线上方占比 划分为：强趋势市/震荡市/弱势市/题材情绪市/恐慌杀跌市/缩量无方向市。个股信号必须受 regime 约束：
   - 强趋势市：允许追随动量；震荡市：降低追高权重，重视VWAP回归；
   - 弱势市：只提示风险，不轻易给积极建议；题材情绪市：提高板块热度/涨停梯队/连板高度权重；
   - 恐慌杀跌市：以规避风险为主，不抄底；缩量无方向市：观望为主，突破假信号多。
3. 板块（第三层）：行业与概念板块的 sector_score（构成：涨幅排名30% + 成交额分位25% + 上涨比例20% + 板块内涨停数15% + 龙头强度10%）。板块强弱放大或削弱个股信号。
4. 决策层 decision：系统已将三层融合为综合机会分 score(0-100，日线30%+日内25%+板块20%+大盘15%+量能10%)、行动建议 action、入场检查清单 checklist（日线趋势/日内强势/放量/板块/大盘/非追高/流动性）、风险警示 warnings。你应当以 decision 为基准进行复核：同意则强化执行细节，不同意则给出明确的数据依据。

# 离场规则（持仓模式时严格遵循；具体阈值以传入数据为准）
- 跟踪止盈：记录进场后最高价 peak；价格自 peak 回撤超过 trail_pct 触发“止盈离场警告”。trail_pct 可能是 ATR 自适应的（随波动率与浮盈档位收紧），以 exit 数据中的实际值为准。
- 止损：相对进场价亏损达到 stop_loss_pct 触发“止损离场警告”，纪律优先于观点。
- 跌破进场价后进入止损监控；回到进场价上方恢复跟踪止盈。
- 你会拿到状态机当前状态(exit.kind)、peak、目标价、止损线、实际生效的 trail/stop 阈值与浮动盈亏，请据此给出“继续持有/部分止盈/全部离场/止损”的明确结论与触发价位。

# 输出要求
- 全程使用简体中文，简洁专业，避免空话。
- 严格基于提供的数据，不要编造未给出的数字；数据缺失(标注为不可用/—)时明确指出其影响。
- 按以下结构输出：
  1. 一句话结论（明确方向与操作倾向，并注明与系统 decision 是否一致）。
  2. 多空依据（分别列出支持做多/看空的关键指标，引用具体数值，含日线与日内两个维度）。
  3. regime 与板块影响（当前市场状态如何调整该结论的力度）。
  4. 关键价位与触发条件：
     - 开仓模式：给出建议的进场区间/触发价、止损位（可参考系统建议止损）、第一目标位，以及“不进场”的条件。
     - 离场模式：结合离场状态机给出“继续持有 / 部分止盈 / 全部离场 / 止损”的判断与对应价位。
  5. 风险提示（一行）。
- 结尾固定附一行：“以上为基于数据的量化研判，非投资建议。”`;

function fmt(n: number | null | undefined, dp = 2, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(dp)}${suffix}`;
}

/** Build the dynamic, per-request payload (placed AFTER the static prefix). */
export function buildDynamicPayload(
  stock: StockSnapshot,
  regime: Regime | null,
  mode: AiMode
): string {
  const q = stock.quote;
  const l = stock.layer1;
  const s = stock.sector;
  const d = stock.decision;
  const lines: string[] = [];

  lines.push(`【分析模式】${mode === "entry" ? "无持仓 → 分析开仓时机" : "持仓中 → 分析离场时机"}`);
  lines.push(`【标的】${stock.name || stock.code}（${stock.symbol}）${q?.stale ? " [数据可能延迟/已收盘]" : ""}`);

  if (q && l) {
    lines.push(
      [
        "【第一层·日内】",
        `现价 ${fmt(l.price, 2)}（${fmt(l.pctChange, 2, "%")}），跳空 ${fmt(l.gapPct, 2, "%")}，日内位置 ${fmt(l.dayRangePos, 0)}/100`,
        `VWAP ${fmt(l.vwap, 3)}，价对VWAP ${fmt(l.priceVsVwap, 2, "%")}，5分钟动量 ${fmt(l.intradayMomentum, 2, "%")}，15分钟动量 ${fmt(l.intradayMomentum15, 2, "%")}`,
        `量比 ${fmt(l.relativeVolume, 2)}，换手率 ${fmt(l.turnoverRate, 2, "%")}，振幅 ${fmt(l.amplitude, 2, "%")}`,
        `距涨停 ${fmt(l.distanceToLimitUp, 2, "%")}，距跌停 ${fmt(l.distanceToLimitDown, 2, "%")}，买卖价差 ${fmt(l.bidAskSpread, 3, "%")}，盘口失衡 ${fmt(l.orderBookImbalance, 2)}（正=买盘占优）`,
        `日内分 intraday_score ${fmt(l.intradayScore, 0)}/100`,
        "【第一层·日线】",
        `MA5/10/20/60：${fmt(l.ma5)}/${fmt(l.ma10)}/${fmt(l.ma20)}/${fmt(l.ma60)}，MA20斜率 ${fmt(l.ma20Slope, 2, "%")}`,
        `MACD：DIF ${fmt(l.macdDif, 3)}，DEA ${fmt(l.macdDea, 3)}，柱 ${fmt(l.macdHist, 3)}（前值 ${fmt(l.macdHistPrev, 3)}）`,
        `RSI14 ${fmt(l.rsi14, 1)}，KDJ ${fmt(l.kdjK, 0)}/${fmt(l.kdjD, 0)}/${fmt(l.kdjJ, 0)}，日ATR ${fmt(l.atrPct, 2, "%")}`,
        `5日涨幅 ${fmt(l.ret5d, 2, "%")}，20日涨幅 ${fmt(l.ret20d, 2, "%")}，60日位置 ${fmt(l.pos60d, 0)}/100，距20日高点 ${fmt(l.distToHigh20, 2, "%")}（负=已突破），量能趋势 ${fmt(l.volTrend, 2)}`,
        `日线分 daily_score ${fmt(l.dailyScore, 0)}/100，综合趋势分 ${fmt(l.trendScore, 0)}/100（${l.trendTag}）`,
      ].join("\n")
    );
  } else {
    lines.push("【第一层 个股指标】数据暂不可用");
  }

  if (s && s.available && s.industry) {
    lines.push(
      `【第三层 板块】行业「${s.industry.name}」涨幅 ${fmt(s.industry.pctChange, 2, "%")}，排名 ${s.industry.rank}/${s.industry.total}，sector_score ${fmt(s.sectorScore, 0)}/100` +
        (s.industry.limitUpCount != null ? `，板块内涨停 ${s.industry.limitUpCount} 家` : "") +
        (s.conceptScore != null ? `；最强概念分 ${fmt(s.conceptScore, 0)}` : "") +
        (s.concepts.length ? `；概念：${s.concepts.map((c) => c.name).join("、")}` : "")
    );
  } else {
    lines.push("【第三层 板块】板块数据不可用（已降级）");
  }

  if (regime) {
    const idx = regime.indices
      .map(
        (i) =>
          `${i.name} ${fmt(i.pctChange, 2, "%")}${i.aboveVwap ? "↑" : "↓"}${i.aboveMa20 != null ? (i.aboveMa20 ? "(20日线上)" : "(20日线下)") : ""}`
      )
      .join("，");
    const b = regime.breadth;
    lines.push(
      [
        `【第二层 市场regime】${regime.label}（强弱分 ${fmt(regime.score, 0)}）`,
        `指数：${idx}`,
        b.available
          ? `涨跌家数 ${b.advancers}/${b.decliners}，涨停 ${b.limitUp}/跌停 ${b.limitDown}` +
            (b.maxLimitStreak != null && b.maxLimitStreak > 0 ? `，最高连板 ${b.maxLimitStreak}` : "") +
            (b.amountChangePct != null ? `，两市成交额较昨日 ${fmt(b.amountChangePct, 1, "%")}（折算）` : "")
          : "涨跌家数/涨停数：不可用（已降级）",
      ].join("\n")
    );
  }

  if (d) {
    const checks = d.checklist
      .map((c) => `${c.pass === true ? "✓" : c.pass === false ? "✗" : "?"}${c.label}`)
      .join(" ");
    lines.push(
      [
        `【决策层 decision】${d.label}（机会分 ${fmt(d.score, 0)}/100，置信度 ${fmt(d.confidence, 0)}）`,
        `检查清单：${checks}`,
        d.reasons.length ? `依据：${d.reasons.join("；")}` : "",
        d.warnings.length ? `警示：${d.warnings.join("；")}` : "",
        d.suggestedStopPrice != null
          ? `系统建议止损 ≈ ${fmt(d.suggestedStopPrice, 3)}（${fmt((d.suggestedStopPct ?? 0) * 100, 1, "%")}，1.8×ATR）`
          : "",
        d.entryHint ? `时机提示：${d.entryHint}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (mode === "exit" && stock.position && stock.exit) {
    const p = stock.position;
    const e = stock.exit;
    lines.push(
      [
        "【持仓与离场状态】",
        `进场价 ${fmt(p.entryPrice, 3)}${p.shares ? `，数量 ${p.shares}` : ""}`,
        `浮动盈亏 ${fmt(e.pnlPct, 2, "%")}，记录最高价 peak ${fmt(e.peak, 3)}`,
        `离场状态 ${e.kind}${e.targetPrice != null ? `，止盈目标 ${fmt(e.targetPrice, 3)}` : ""}，止损线 ${fmt(e.stopLossPrice, 3)}`,
        `生效阈值：跟踪止盈回撤 ${fmt(e.trailPct * 100, 2, "%")}（${e.trailMode === "atr" ? "ATR自适应" : "固定"}），止损 ${fmt(e.stopLossPct * 100, 2, "%")}`,
        e.message ? `当前提示：${e.message}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  lines.push(
    mode === "entry"
      ? "请据此分析该股票的走势与开仓时机，对系统 decision 进行复核，给出明确的进场/观望结论与关键价位。"
      : "请据此分析该股票的走势与离场时机，结合离场状态机给出继续持有/止盈/止损的明确结论与关键价位。"
  );

  return lines.join("\n");
}
