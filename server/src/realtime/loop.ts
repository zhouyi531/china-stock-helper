import { config } from "../config.js";
import { appState } from "../state.js";
import { getMarketClock, sessionVolumeFraction } from "../marketClock.js";
import { fetchQuotes, fetchDaily, type DailyBar } from "../providers/index.js";
import { shanghaiDateIso } from "../providers/eastmoney.js";
import { computeLayer1, type TickPoint } from "../indicators/layer1.js";
import { fetchRegime } from "../regime/layer2.js";
import { sectorService } from "../sector/layer3.js";
import { computeDecision } from "../decision/engine.js";
import { adaptiveTrailBase, stepExit, type ExitConfig } from "../exit/engine.js";
import {
  getExitRow,
  getPosition,
  listWatch,
  saveExitRow,
  updateWatchName,
} from "../store/db.js";
import { hub } from "./hub.js";
import type {
  FullSnapshot,
  Layer1Metrics,
  MarketClock,
  Position,
  Quote,
  StockSnapshot,
  Symbol,
} from "../types.js";

const TICK_WINDOW_MS = 15 * 60 * 1000; // keep 15 min for momentum windows
const DAILY_TTL_MS = 5 * 60 * 1000;
const DAILY_BARS = 160; // MA60 + MACD warmup need deep history
const STALE_AFTER_MS = 60 * 1000;

const dailyCache = new Map<Symbol, { ts: number; bars: DailyBar[] }>();
const dailyInflight = new Set<Symbol>();
const tickBuffer = new Map<Symbol, TickPoint[]>();

function pushTick(symbol: Symbol, price: number): TickPoint[] {
  const now = Date.now();
  const buf = tickBuffer.get(symbol) ?? [];
  buf.push({ t: now, price });
  const cutoff = now - TICK_WINDOW_MS;
  while (buf.length && buf[0].t < cutoff) buf.shift();
  tickBuffer.set(symbol, buf);
  return buf;
}

function refreshDailyIfNeeded(symbol: Symbol): void {
  const cur = dailyCache.get(symbol);
  if (cur && Date.now() - cur.ts < DAILY_TTL_MS) return;
  if (dailyInflight.has(symbol)) return;
  dailyInflight.add(symbol);
  fetchDaily(symbol, DAILY_BARS)
    .then((bars) => {
      if (bars.length) dailyCache.set(symbol, { ts: Date.now(), bars });
    })
    .catch(() => {})
    .finally(() => dailyInflight.delete(symbol));
}

/**
 * Effective exit thresholds for a position:
 *  - user per-stock override > global env pin > ATR-adaptive (default)
 */
export function effectiveExitConfig(
  position: Position,
  layer1: Layer1Metrics | null
): ExitConfig {
  const stopLossPct = position.stopLossPct ?? config.exit.stopLossPct;
  if (position.trailPct != null) {
    return { trailPct: position.trailPct, stopLossPct, trailMode: "fixed" };
  }
  if (config.exit.trailPct != null) {
    return { trailPct: config.exit.trailPct, stopLossPct, trailMode: "fixed" };
  }
  return {
    trailPct: adaptiveTrailBase(layer1?.atrPct ?? null),
    stopLossPct,
    trailMode: "atr",
  };
}

function buildStockSnapshot(
  symbol: Symbol,
  name: string,
  pinned: boolean,
  quote: Quote | undefined,
  clock: MarketClock
): StockSnapshot {
  const market = symbol.slice(0, 2) as StockSnapshot["market"];
  const code = symbol.slice(2);
  const base: StockSnapshot = {
    symbol,
    code,
    name,
    market,
    pinned,
    quote: null,
    layer1: null,
    sector: null,
    decision: null,
    position: null,
    exit: null,
  };

  if (!quote) {
    base.error = "行情暂不可用";
    base.position = getPosition(symbol);
    return base;
  }

  // staleness
  quote.stale = !clock.open || Date.now() - quote.ts > STALE_AFTER_MS;
  if (name && !quote.name) quote.name = name;
  if (quote.name && !name) updateWatchName(symbol, quote.name);

  refreshDailyIfNeeded(symbol);
  const ticks = pushTick(symbol, quote.price);
  const daily = dailyCache.get(symbol)?.bars ?? [];

  const layer1 = computeLayer1(quote, {
    daily,
    ticks,
    volumeFraction: sessionVolumeFraction(),
    todayIso: shanghaiDateIso(),
  });

  const sector = sectorService.getStockSector(symbol);

  const position = getPosition(symbol);
  let exit = null;
  if (position) {
    const prev = getExitRow(symbol);
    const st = stepExit(
      prev ? { kind: prev.kind, peak: prev.peak } : null,
      position.entryPrice,
      quote.price,
      effectiveExitConfig(position, layer1)
    );
    st.symbol = symbol;
    // a user acknowledgement only survives while the state kind is unchanged
    st.acknowledged = prev != null && prev.kind === st.kind && prev.ack === 1;
    saveExitRow(symbol, st.kind, st.peak, st.acknowledged);
    exit = st;
  }

  const decision = computeDecision({
    quote,
    layer1,
    sector,
    regime: appState.latestRegime,
    position,
    exit,
    clock,
  });

  return { ...base, quote, layer1, sector, decision, position, exit };
}

async function tickQuotes(): Promise<void> {
  const watch = listWatch();
  const clock = getMarketClock();
  if (watch.length === 0) {
    const snap: FullSnapshot = { clock, stocks: [], regime: appState.latestRegime, ts: Date.now() };
    appState.latestSnapshot = snap;
    hub.broadcast({ type: "tick", data: snap });
    return;
  }

  const symbols = watch.map((w) => w.symbol);
  let quotes = new Map<Symbol, Quote>();
  try {
    quotes = await fetchQuotes(symbols);
  } catch {
    // degraded: keep building with missing quotes
  }

  const stocks = watch.map((w) =>
    buildStockSnapshot(w.symbol, w.name, w.pinned === 1, quotes.get(w.symbol), clock)
  );

  const snap: FullSnapshot = {
    clock,
    stocks,
    regime: appState.latestRegime,
    ts: Date.now(),
  };
  appState.latestSnapshot = snap;
  hub.broadcast({ type: "tick", data: snap });
}

async function tickRegime(): Promise<void> {
  try {
    appState.latestRegime = await fetchRegime();
  } catch {
    // keep last regime
  }
}

async function tickSectors(): Promise<void> {
  await sectorService.refresh();
  for (const w of listWatch()) {
    sectorService.ensureBinding(w.symbol).catch(() => {});
  }
}

/** Rebuild + broadcast a snapshot right away (used after user mutations for a snappy UI). */
export function requestTick(): void {
  void tickQuotes();
}

export function startRealtime(): () => void {
  // kick off immediately, then on intervals
  void tickRegime();
  void tickSectors();
  void tickQuotes();

  const q = setInterval(() => void tickQuotes(), config.poll.quoteMs);
  const r = setInterval(() => void tickRegime(), config.poll.regimeMs);
  const s = setInterval(() => void tickSectors(), config.poll.sectorMs);

  return () => {
    clearInterval(q);
    clearInterval(r);
    clearInterval(s);
  };
}
