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

/** Layer 1: per-stock derived metrics. */
export interface Layer1Metrics {
  price: number;
  pctChange: number; // %
  gapPct: number; // %
  vwap: number;
  priceVsVwap: number; // % distance above/below vwap
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  intradayMomentum: number; // % over recent window
  relativeVolume: number; // ratio vs historical baseline
  turnoverRate: number; // %
  amplitude: number; // %
  volatility: number; // % (daily return stddev, annualised-free)
  distanceToLimitUp: number; // %
  distanceToLimitDown: number; // %
  bidAskSpread: number; // %
  orderBookImbalance: number; // -1..1
  /** composite single-stock trend score 0..100 */
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
  intradayDrawdown: number; // % from intraday high
}

export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  limitUp: number;
  limitDown: number;
  totalAmount: number; // 元, whole market
  amountChangePct: number | null; // vs previous day, if known
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
  available: boolean;
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
  message: string | null;
  updatedAt: number;
}

/** What the frontend renders per watched stock. */
export interface StockSnapshot {
  symbol: Symbol;
  code: string;
  name: string;
  market: Market;
  quote: Quote | null;
  layer1: Layer1Metrics | null;
  sector: StockSectorInfo | null;
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
