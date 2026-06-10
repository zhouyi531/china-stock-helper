// Shared wire types between server and web.

export type Market = "sh" | "sz" | "bj";

/** A fully-qualified symbol, e.g. "sh600000". */
export type Symbol = string;

export interface OrderBookLevel {
  price: number;
  /** volume in 手 (lots, 100 shares) */
  volume: number;
}

/** Raw, source-agnostic realtime quote (one tick). */
export interface Quote {
  symbol: Symbol;
  code: string;
  name: string;
  market: Market;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  /** cumulative traded volume today, 手 */
  volume: number;
  /** cumulative traded amount today, 元 */
  amount: number;
  /** average price today = amount / (volume*100); ≈ VWAP */
  avgPrice: number;
  turnoverRate: number; // 换手率 %
  amplitude: number; // 振幅 %
  volumeRatio: number; // 量比
  limitUp: number; // 涨停价
  limitDown: number; // 跌停价
  pe: number;
  pb: number;
  bids: OrderBookLevel[]; // index 0 = bid1 (best)
  asks: OrderBookLevel[]; // index 0 = ask1 (best)
  /** epoch ms of the quote timestamp reported by the source */
  ts: number;
  stale: boolean;
}

export type TrendTag = "bull" | "bear" | "neutral";

/** Layer 1: per-stock derived metrics (intraday + daily timeframe). */
export interface Layer1Metrics {
  price: number;
  pctChange: number; // %
  gapPct: number; // %
  vwap: number;
  priceVsVwap: number; // % distance above/below vwap
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  /** % change over the last ~5 minutes of ticks */
  intradayMomentum: number;
  /** % change over the last ~15 minutes of ticks */
  intradayMomentum15: number;
  relativeVolume: number; // ratio vs historical baseline
  turnoverRate: number; // %
  amplitude: number; // %
  volatility: number; // % (20d daily return stddev)
  distanceToLimitUp: number; // %
  distanceToLimitDown: number; // %
  bidAskSpread: number; // %
  orderBookImbalance: number; // -1..1
  /** position of price within today's range, 0..100 (100 = at high) */
  dayRangePos: number | null;

  // ---- daily timeframe indicators (computed on qfq daily bars incl. today live) ----
  macdDif: number | null;
  macdDea: number | null;
  /** Chinese-convention bar = 2×(DIF−DEA) */
  macdHist: number | null;
  /** previous bar's hist, for rising/falling detection */
  macdHistPrev: number | null;
  rsi14: number | null;
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;
  /** Wilder ATR(14) as % of price — volatility unit for stops */
  atrPct: number | null;
  /** % return over last 5 / 20 completed-ish days */
  ret5d: number | null;
  ret20d: number | null;
  /** price position inside the 60d high-low range, 0..100 */
  pos60d: number | null;
  /** % distance to the highest high of the previous 20 days (negative = broke out above) */
  distToHigh20: number | null;
  /** mean(vol last 5d) / mean(vol last 20d) — volume trend */
  volTrend: number | null;
  /** MA20 slope: % change of MA20 vs 5 bars ago */
  ma20Slope: number | null;

  // ---- scores ----
  /** intraday strength 0..100 (timing layer) */
  intradayScore: number;
  /** daily-timeframe trend quality 0..100 (direction layer) */
  dailyScore: number | null;
  /** fused stock score 0..100 = 0.55×intraday + 0.45×daily (intraday only when no daily data) */
  trendScore: number;
  trendTag: TrendTag;
}

export interface IndexSnapshot {
  symbol: Symbol;
  name: string;
  price: number;
  pctChange: number;
  amount: number;
  aboveVwap: boolean;
  /** index above its daily MA20 (medium-term health); null when unknown */
  aboveMa20: boolean | null;
  intradayDrawdown: number; // % from intraday high
}

export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  limitUp: number;
  limitDown: number;
  /** highest 连板 height in today's limit-up pool (theme temperature) */
  maxLimitStreak: number | null;
  totalAmount: number; // 元, whole market
  /** projected full-day amount vs yesterday's total, % (time-of-day adjusted) */
  amountChangePct: number | null;
  available: boolean; // false when source degraded
}

export type RegimeKind =
  | "strong_trend" // 强趋势市
  | "range" // 震荡市
  | "weak" // 弱势市
  | "theme" // 题材情绪市
  | "panic" // 恐慌杀跌市
  | "low_volume"; // 缩量无方向市

export interface Regime {
  kind: RegimeKind;
  label: string;
  score: number; // -100..100 risk/strength composite
  indices: IndexSnapshot[];
  breadth: Breadth;
  reasons: string[];
  ts: number;
}

export interface SectorRef {
  code: string;
  name: string;
  type: "industry" | "concept";
}

export interface SectorBoard {
  code: string;
  name: string;
  type: "industry" | "concept";
  pctChange: number;
  rank: number; // 1 = strongest
  total: number; // count of boards of this type
  amount: number;
  amountChangePct: number | null;
  upRatio: number | null; // share of members up
  limitUpCount: number | null;
  /** highest 连板 streak among members (theme height) */
  maxLimitStreak: number | null;
  leaderStrength: number | null; // top member strength
  /** composite per doc formula, 0..100 */
  score: number;
  available: boolean;
}

/** Layer 3 binding for a single stock. */
export interface StockSectorInfo {
  industry: SectorBoard | null;
  concepts: SectorRef[];
  sectorScore: number; // = industry.score when available
  /** best matched concept board score, when resolvable */
  conceptScore: number | null;
  available: boolean;
}

// ---- Decision engine (fused buy/sell signal) ----

export type DecisionAction =
  | "strong_buy" // 强烈买入信号
  | "buy" // 可买入
  | "watch" // 观望
  | "hold" // 持有
  | "reduce" // 减仓
  | "exit" // 离场
  | "avoid"; // 回避

export interface DecisionCheck {
  key: string;
  label: string;
  /** true=满足 false=不满足 null=数据缺失 */
  pass: boolean | null;
  detail: string;
}

export interface Decision {
  action: DecisionAction;
  label: string; // Chinese label
  /** fused opportunity score 0..100: 日线30% + 日内25% + 板块20% + 大盘15% + 量能10% */
  score: number;
  /** data completeness & component agreement, 0..100 */
  confidence: number;
  reasons: string[]; // supporting evidence
  warnings: string[]; // risk flags
  /** the 5-condition entry checklist (上涨+放量+VWAP上方+板块走强+大盘配合 …) */
  checklist: DecisionCheck[];
  /** suggested initial stop for a NEW entry (ATR-based), fraction of price */
  suggestedStopPct: number | null;
  suggestedStopPrice: number | null;
  /** short timing hint, e.g. 回踩VWAP企稳再进 */
  entryHint: string | null;
  ts: number;
}

export type ExitStateKind =
  | "none" // no position
  | "watching" // tracking peak
  | "take_profit_warn"
  | "stop_loss_watch"
  | "stop_loss_warn"
  | "exited";

export interface Position {
  symbol: Symbol;
  entryPrice: number;
  /** optional share count for P/L money calc */
  shares: number | null;
  /** per-stock override of the trailing take-profit drawdown (fraction); null = ATR-adaptive */
  trailPct: number | null;
  /** per-stock override of the stop-loss threshold (fraction); null = global default */
  stopLossPct: number | null;
  createdAt: number;
}

export interface ExitState {
  symbol: Symbol;
  kind: ExitStateKind;
  entryPrice: number;
  peak: number;
  /** take-profit target = peak*(1-trail) when warning active */
  targetPrice: number | null;
  /** stop-loss line = entry*(1-stopLoss) */
  stopLossPrice: number;
  pnlPct: number; // current P/L vs entry, %
  /** effective trailing drawdown threshold in use (fraction, after ATR/profit-tier adjustment) */
  trailPct: number;
  /** effective stop-loss threshold in use (fraction) */
  stopLossPct: number;
  /** "fixed" when the user pinned a trail %, "atr" when adaptive */
  trailMode: "fixed" | "atr";
  /** user dismissed the current warning; auto-resets when the state kind changes */
  acknowledged: boolean;
  message: string | null;
  updatedAt: number;
}

/** What the frontend renders per watched stock. */
export interface StockSnapshot {
  symbol: Symbol;
  code: string;
  name: string;
  market: Market;
  /** User pinned this stock to the top of the watchlist. */
  pinned?: boolean;
  quote: Quote | null;
  layer1: Layer1Metrics | null;
  sector: StockSectorInfo | null;
  decision: Decision | null;
  position: Position | null;
  exit: ExitState | null;
  error?: string;
}

export interface MarketClock {
  open: boolean;
  session: "pre" | "morning" | "lunch" | "afternoon" | "closed";
  serverTime: number;
  label: string;
}

export interface FullSnapshot {
  clock: MarketClock;
  stocks: StockSnapshot[];
  regime: Regime | null;
  ts: number;
}

// ---- Market scanner (选股) ----

export interface ScanCandidate {
  symbol: Symbol;
  code: string;
  name: string;
  price: number;
  pctChange: number;
  /** 涨速: recent few-minute % change from the source */
  speedPct: number | null;
  volumeRatio: number | null;
  turnoverRate: number | null;
  amount: number; // 元
  dayRangePos: number | null; // 0..100
  industry: string | null;
  industryScore: number | null;
  industryRank: number | null;
  score: number; // 0..100
  reasons: string[];
  warnings: string[];
  inWatchlist: boolean;
}

export interface ScanResult {
  candidates: ScanCandidate[];
  /** universe size after filters */
  scanned: number;
  regimeKind: RegimeKind | null;
  regimeNote: string | null;
  ts: number;
}

// ---- Backtest ----

export type BacktestStrategy = "ma" | "breakout";

export interface BacktestTrade {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  pnlPct: number;
  holdDays: number;
  exitReason: "trail" | "hard_stop" | "signal" | "eod";
}

export interface BacktestMetrics {
  trades: number;
  winRate: number | null; // %
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  totalReturnPct: number; // compounded
  maxDrawdownPct: number;
  avgHoldDays: number | null;
  buyHoldReturnPct: number;
}

export interface BacktestResult {
  symbol: Symbol;
  strategy: BacktestStrategy;
  bars: number;
  startDate: string | null;
  endDate: string | null;
  trailPct: number;
  stopPct: number;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  /** optional parameter sweep table over trailing-stop values */
  sweep: { trailPct: number; metrics: BacktestMetrics }[] | null;
}

// ---- AI ----

export type AiMode = "entry" | "exit";

export interface AiAnalysisRecord {
  id: number;
  symbol: Symbol;
  mode: AiMode;
  content: string;
  model: string;
  createdAt: number;
}

// ---- WebSocket envelope ----

export type WsMessage =
  | { type: "snapshot"; data: FullSnapshot }
  | { type: "tick"; data: FullSnapshot }
  | { type: "error"; message: string };
