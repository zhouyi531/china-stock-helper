import type { AiMode, Regime, StockSnapshot } from "../types.js";

/**
 * STATIC, byte-identical instruction prefix sent on EVERY request as the first
 * input item. Keeping it constant lets OpenAI prompt-caching reuse the prefix
 * across calls (the dynamic per-stock data goes in a separate trailing message).
 * Do NOT interpolate any dynamic values (no dates, prices, names) in here.
 */
export const STATIC_PREFIX = `你是一名资深的中国A股日内交易分析助手。你的任务是基于调用方提供的结构化实时数据，对单只股票给出客观、可执行的走势研判。

# 分析框架（三层）
1. 个股实时趋势（第一层）：综合 价格相对VWAP/均价、分钟级动量(intraday_momentum)、成交量相对放大(relative_volume/量比)、均线多空(MA5/10/20)、换手率、振幅、波动率、距涨停/跌停空间、买卖价差与盘口失衡(order_book_imbalance)。核心判断：上涨是否伴随“放量 + 站上VWAP + 均线多头 + 盘口买盘占优”，单纯股价上涨没有意义。
2. 市场环境（第二层 regime）：根据沪深300/中证500/创业板指/科创50/上证 指数、涨跌家数、涨停/跌停数、成交额，市场被划分为：强趋势市/震荡市/弱势市/题材情绪市/恐慌杀跌市/缩量无方向市。个股信号必须受 regime 约束：
   - 强趋势市：允许追随动量；
   - 震荡市：降低追高权重，重视VWAP回归；
   - 弱势市：只提示风险，不轻易给积极建议；
   - 题材情绪市：提高板块热度、涨停家数、连板高度权重；
   - 恐慌杀跌市：以规避风险为主；
   - 缩量无方向市：观望为主。
3. 板块/题材强弱（第三层）：参考个股所属行业/概念的 sector_score、板块涨幅排名、板块内上涨比例、龙头强度。板块强弱会放大或削弱个股信号。

# 离场规则（当处于持仓/离场分析模式时严格遵循）
- 跟踪止盈：从进场价开始记录最高价 peak；当价格自 peak 回撤超过 0.15% 时触发“止盈离场警告”，目标价≈peak×(1−0.15%)。
- 若未离场继续持有：价格重新涨回目标价上方则警告解除、继续跟踪 peak；若价格跌破进场价，则止盈警告解除并进入止损监控。
- 止损：相对进场价亏损达到 3% 触发“止损离场警告”。
- 你会拿到当前离场状态机的状态(exit.kind)、peak、目标价、止损线与浮动盈亏，请结合这些给出“是否应当离场/继续持有/加仓减仓”的明确结论与触发价位。

# 输出要求
- 全程使用简体中文，简洁专业，避免空话。
- 严格基于提供的数据，不要编造未给出的数字；数据缺失(标注为不可用/0/—)时明确指出其影响。
- 按以下结构输出：
  1. 一句话结论（明确方向与操作倾向）。
  2. 多空依据（分别列出支持做多/看空的关键指标，引用具体数值）。
  3. regime 与板块影响（说明当前市场状态如何调整该结论的力度）。
  4. 关键价位与触发条件：
     - 开仓模式：给出建议的进场区间/触发价、止损位、第一目标位，以及“不进场”的条件。
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
  const lines: string[] = [];

  lines.push(`【分析模式】${mode === "entry" ? "无持仓 → 分析开仓时机" : "持仓中 → 分析离场时机"}`);
  lines.push(`【标的】${stock.name || stock.code}（${stock.symbol}）${q?.stale ? " [数据可能延迟/已收盘]" : ""}`);

  if (q && l) {
    lines.push(
      [
        "【第一层 个股指标】",
        `现价 ${fmt(l.price, 2)}（${fmt(l.pctChange, 2, "%")}），跳空 ${fmt(l.gapPct, 2, "%")}`,
        `VWAP/均价 ${fmt(l.vwap, 3)}，价对VWAP ${fmt(l.priceVsVwap, 2, "%")}`,
        `MA5/10/20 ${fmt(l.ma5)}/${fmt(l.ma10)}/${fmt(l.ma20)}`,
        `分钟动量 ${fmt(l.intradayMomentum, 2, "%")}，相对量能 ${fmt(l.relativeVolume, 2)}，换手率 ${fmt(l.turnoverRate, 2, "%")}`,
        `振幅 ${fmt(l.amplitude, 2, "%")}，波动率 ${fmt(l.volatility, 2, "%")}`,
        `距涨停 ${fmt(l.distanceToLimitUp, 2, "%")}，距跌停 ${fmt(l.distanceToLimitDown, 2, "%")}`,
        `买卖价差 ${fmt(l.bidAskSpread, 3, "%")}，盘口失衡 ${fmt(l.orderBookImbalance, 2)}（正=买盘占优）`,
        `综合趋势分 ${fmt(l.trendScore, 0)}/100（${l.trendTag}）`,
      ].join("\n")
    );
  } else {
    lines.push("【第一层 个股指标】数据暂不可用");
  }

  if (s && s.available && s.industry) {
    lines.push(
      `【第三层 板块】行业「${s.industry.name}」涨幅 ${fmt(s.industry.pctChange, 2, "%")}，排名 ${s.industry.rank}/${s.industry.total}，sector_score ${fmt(s.sectorScore, 0)}/100` +
        (s.concepts.length ? `；概念：${s.concepts.map((c) => c.name).join("、")}` : "")
    );
  } else {
    lines.push("【第三层 板块】板块数据不可用（已降级）");
  }

  if (regime) {
    const idx = regime.indices
      .map((i) => `${i.name} ${fmt(i.pctChange, 2, "%")}${i.aboveVwap ? "↑" : "↓"}`)
      .join("，");
    const b = regime.breadth;
    lines.push(
      [
        `【第二层 市场regime】${regime.label}（强弱分 ${fmt(regime.score, 0)}）`,
        `指数：${idx}`,
        b.available
          ? `涨跌家数 ${b.advancers}/${b.decliners}，涨停 ${b.limitUp}/跌停 ${b.limitDown}`
          : "涨跌家数/涨停数：不可用（已降级）",
      ].join("\n")
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
        e.message ? `当前提示：${e.message}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  lines.push(
    mode === "entry"
      ? "请据此分析该股票的走势与开仓时机，给出明确的进场/观望结论与关键价位。"
      : "请据此分析该股票的走势与离场时机，结合离场状态机给出继续持有/止盈/止损的明确结论与关键价位。"
  );

  return lines.join("\n");
}
