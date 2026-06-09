// Wire types mirrored from the server.

export type Market = "sh" | "sz" | "bj";

export interface OrderBookLevel {
  price: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  code: string;
  name: string;
  market: Market;
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  avgPrice: number;
  turnoverRate: number;
  amplitude: number;
  volumeRatio: number;
  limitUp: number;
  limitDown: number;
  pe: number;
  pb: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  ts: number;
  stale: boolean;
}

export type TrendTag = "bull" | "bear" | "neutral";

export interface Layer1Metrics {
  price: number;
  pctChange: number;
  gapPct: number;
  vwap: number;
  priceVsVwap: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  intradayMomentum: number;
  relativeVolume: number;
  turnoverRate: number;
  amplitude: number;
  volatility: number;
  distanceToLimitUp: number;
  distanceToLimitDown: number;
  bidAskSpread: number;
  orderBookImbalance: number;
  trendScore: number;
  trendTag: TrendTag;
}

export interface IndexSnapshot {
  symbol: string;
  name: string;
  price: number;
  pctChange: number;
  amount: number;
  aboveVwap: boolean;
  intradayDrawdown: number;
}

export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  limitUp: number;
  limitDown: number;
  totalAmount: number;
  amountChangePct: number | null;
  available: boolean;
}

export type RegimeKind =
  | "strong_trend"
  | "range"
  | "weak"
  | "theme"
  | "panic"
  | "low_volume";

export interface Regime {
  kind: RegimeKind;
  label: string;
  score: number;
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
  rank: number;
  total: number;
  amount: number;
  amountChangePct: number | null;
  upRatio: number | null;
  limitUpCount: number | null;
  leaderStrength: number | null;
  score: number;
  available: boolean;
}

export interface StockSectorInfo {
  industry: SectorBoard | null;
  concepts: SectorRef[];
  sectorScore: number;
  available: boolean;
}

export type ExitStateKind =
  | "none"
  | "watching"
  | "take_profit_warn"
  | "stop_loss_watch"
  | "stop_loss_warn"
  | "exited";

export interface Position {
  symbol: string;
  entryPrice: number;
  shares: number | null;
  /** trailing take-profit drawdown, fraction (e.g. 0.0015) */
  trailPct: number;
  /** stop-loss distance below entry, fraction (e.g. 0.03) */
  stopLossPct: number;
  createdAt: number;
}

export interface ExitState {
  symbol: string;
  kind: ExitStateKind;
  entryPrice: number;
  peak: number;
  targetPrice: number | null;
  stopLossPrice: number;
  pnlPct: number;
  message: string | null;
  updatedAt: number;
}

export interface FundFlow {
  /** 主力净流入净额, 元 (positive = 净流入) */
  mainNetInflow: number;
  /** 主力净流入净占比, % */
  mainNetRatio: number;
  available: boolean;
}

export interface StockSnapshot {
  symbol: string;
  code: string;
  name: string;
  market: Market;
  quote: Quote | null;
  layer1: Layer1Metrics | null;
  fundFlow: FundFlow | null;
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

export interface ExitDefaults {
  trailPct: number;
  stopLossPct: number;
}

export interface FullSnapshot {
  clock: MarketClock;
  stocks: StockSnapshot[];
  regime: Regime | null;
  exitDefaults: ExitDefaults;
  ts: number;
}

export type AiMode = "entry" | "exit";

export interface AiAnalysisRecord {
  id: number;
  symbol: string;
  mode: AiMode;
  content: string;
  model: string;
  createdAt: number;
}

export interface KlineBar {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
}

export interface MinutePoint {
  time: string;
  price: number;
  cumVolume: number;
  cumAmount: number;
}

export interface KlineResponse {
  symbol: string;
  daily: KlineBar[];
  minute: MinutePoint[];
  ma: { ma5: number | null; ma10: number | null; ma20: number | null }[];
}

export type WsMessage =
  | { type: "snapshot"; data: FullSnapshot }
  | { type: "tick"; data: FullSnapshot }
  | { type: "error"; message: string };
