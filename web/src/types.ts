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
  ma60: number | null;
  intradayMomentum: number;
  intradayMomentum15: number;
  relativeVolume: number;
  turnoverRate: number;
  amplitude: number;
  volatility: number;
  distanceToLimitUp: number;
  distanceToLimitDown: number;
  bidAskSpread: number;
  orderBookImbalance: number;
  dayRangePos: number | null;

  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;
  macdHistPrev: number | null;
  rsi14: number | null;
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;
  atrPct: number | null;
  ret5d: number | null;
  ret20d: number | null;
  pos60d: number | null;
  distToHigh20: number | null;
  volTrend: number | null;
  ma20Slope: number | null;

  intradayScore: number;
  dailyScore: number | null;
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
  aboveMa20: boolean | null;
  intradayDrawdown: number;
}

export interface Breadth {
  advancers: number;
  decliners: number;
  unchanged: number;
  limitUp: number;
  limitDown: number;
  maxLimitStreak: number | null;
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
  maxLimitStreak: number | null;
  leaderStrength: number | null;
  score: number;
  available: boolean;
}

export interface StockSectorInfo {
  industry: SectorBoard | null;
  concepts: SectorRef[];
  sectorScore: number;
  conceptScore: number | null;
  available: boolean;
}

// ---- Decision ----

export type DecisionAction =
  | "strong_buy"
  | "buy"
  | "watch"
  | "hold"
  | "reduce"
  | "exit"
  | "avoid";

export interface DecisionCheck {
  key: string;
  label: string;
  pass: boolean | null;
  detail: string;
}

export interface Decision {
  action: DecisionAction;
  label: string;
  score: number;
  confidence: number;
  reasons: string[];
  warnings: string[];
  checklist: DecisionCheck[];
  suggestedStopPct: number | null;
  suggestedStopPrice: number | null;
  entryHint: string | null;
  ts: number;
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
  /** per-stock threshold overrides (fractions); null = ATR-adaptive/global */
  trailPct: number | null;
  stopLossPct: number | null;
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
  /** effective thresholds in use (fractions) */
  trailPct: number;
  stopLossPct: number;
  trailMode: "fixed" | "atr";
  acknowledged: boolean;
  message: string | null;
  updatedAt: number;
}

export interface StockSnapshot {
  symbol: string;
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

// ---- Scanner ----

export interface ScanCandidate {
  symbol: string;
  code: string;
  name: string;
  price: number;
  pctChange: number;
  speedPct: number | null;
  volumeRatio: number | null;
  turnoverRate: number | null;
  amount: number;
  dayRangePos: number | null;
  industry: string | null;
  industryScore: number | null;
  industryRank: number | null;
  score: number;
  reasons: string[];
  warnings: string[];
  inWatchlist: boolean;
}

export interface ScanResult {
  candidates: ScanCandidate[];
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
  winRate: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  totalReturnPct: number;
  maxDrawdownPct: number;
  avgHoldDays: number | null;
  buyHoldReturnPct: number;
}

export interface BacktestResult {
  symbol: string;
  strategy: BacktestStrategy;
  bars: number;
  startDate: string | null;
  endDate: string | null;
  trailPct: number;
  stopPct: number;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  sweep: { trailPct: number; metrics: BacktestMetrics }[] | null;
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
