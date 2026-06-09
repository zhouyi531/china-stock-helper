import { config } from "../config.js";
import { appState } from "../state.js";
import { getMarketClock, sessionElapsedFraction } from "../marketClock.js";
import { fetchQuotes, fetchDaily, fetchFundFlow, type DailyBar } from "../providers/index.js";
import { computeLayer1 } from "../indicators/layer1.js";
import { fetchRegime } from "../regime/layer2.js";
import { sectorService } from "../sector/layer3.js";
import { stepExit } from "../exit/engine.js";
import {
  getExitRow,
  getPosition,
  listWatch,
  saveExitRow,
  updateWatchName,
} from "../store/db.js";
import { hub } from "./hub.js";
import type { FullSnapshot, FundFlow, Quote, StockSnapshot, Symbol } from "../types.js";

const MOMENTUM_WINDOW_MS = 5 * 60 * 1000;
const DAILY_TTL_MS = 5 * 60 * 1000;
const STALE_AFTER_MS = 60 * 1000;
const FUNDFLOW_TTL_MS = 12 * 1000;

let fundFlowCache: { ts: number; map: Map<Symbol, FundFlow> } = { ts: 0, map: new Map() };

/** Bulk main-force net inflow, cached briefly (changes slowly intraday). */
async function getFundFlow(symbols: Symbol[]): Promise<Map<Symbol, FundFlow>> {
  if (fundFlowCache.map.size && Date.now() - fundFlowCache.ts < FUNDFLOW_TTL_MS) {
    return fundFlowCache.map;
  }
  const map = await fetchFundFlow(symbols);
  if (map.size) fundFlowCache = { ts: Date.now(), map };
  return fundFlowCache.map;
}

interface TickPoint {
  t: number;
  price: number;
}

const dailyCache = new Map<Symbol, { ts: number; bars: DailyBar[] }>();
const dailyInflight = new Set<Symbol>();
const tickBuffer = new Map<Symbol, TickPoint[]>();

function pushTick(symbol: Symbol, price: number): number[] {
  const now = Date.now();
  const buf = tickBuffer.get(symbol) ?? [];
  buf.push({ t: now, price });
  const cutoff = now - MOMENTUM_WINDOW_MS;
  while (buf.length && buf[0].t < cutoff) buf.shift();
  tickBuffer.set(symbol, buf);
  return buf.map((p) => p.price);
}

function refreshDailyIfNeeded(symbol: Symbol): void {
  const cur = dailyCache.get(symbol);
  if (cur && Date.now() - cur.ts < DAILY_TTL_MS) return;
  if (dailyInflight.has(symbol)) return;
  dailyInflight.add(symbol);
  fetchDaily(symbol, 60)
    .then((bars) => {
      if (bars.length) dailyCache.set(symbol, { ts: Date.now(), bars });
    })
    .catch(() => {})
    .finally(() => dailyInflight.delete(symbol));
}

function buildStockSnapshot(
  symbol: Symbol,
  name: string,
  quote: Quote | undefined,
  open: boolean,
  fundFlow: FundFlow | null = null
): StockSnapshot {
  const market = symbol.slice(0, 2) as StockSnapshot["market"];
  const code = symbol.slice(2);
  const base: StockSnapshot = {
    symbol,
    code,
    name,
    market,
    quote: null,
    layer1: null,
    fundFlow,
    sector: null,
    position: null,
    exit: null,
  };

  if (!quote) {
    base.error = "行情暂不可用";
    base.position = getPosition(symbol);
    return base;
  }

  // staleness
  quote.stale = !open || Date.now() - quote.ts > STALE_AFTER_MS;
  if (name && !quote.name) quote.name = name;
  if (quote.name && !name) updateWatchName(symbol, quote.name);

  refreshDailyIfNeeded(symbol);
  const recentPrices = pushTick(symbol, quote.price);
  const daily = dailyCache.get(symbol)?.bars ?? [];

  const layer1 = computeLayer1(quote, {
    daily,
    recentPrices,
    elapsedFraction: sessionElapsedFraction(),
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
      { trailPct: position.trailPct, stopLossPct: position.stopLossPct }
    );
    st.symbol = symbol;
    saveExitRow(symbol, st.kind, st.peak);
    exit = st;
  }

  return { ...base, quote, layer1, sector, position, exit };
}

async function tickQuotes(): Promise<void> {
  const watch = listWatch();
  const clock = getMarketClock();
  if (watch.length === 0) {
    const snap: FullSnapshot = {
      clock,
      stocks: [],
      regime: appState.latestRegime,
      exitDefaults: { trailPct: config.exit.trailPct, stopLossPct: config.exit.stopLossPct },
      ts: Date.now(),
    };
    appState.latestSnapshot = snap;
    hub.broadcast({ type: "tick", data: snap });
    return;
  }

  const symbols = watch.map((w) => w.symbol);
  const fundFlowP = getFundFlow(symbols);
  let quotes = new Map<Symbol, Quote>();
  try {
    quotes = await fetchQuotes(symbols);
  } catch {
    // degraded: keep building with missing quotes
  }
  const fundFlow = await fundFlowP;

  const stocks = watch.map((w) =>
    buildStockSnapshot(w.symbol, w.name, quotes.get(w.symbol), clock.open, fundFlow.get(w.symbol) ?? null)
  );

  const snap: FullSnapshot = {
    clock,
    stocks,
    regime: appState.latestRegime,
    exitDefaults: { trailPct: config.exit.trailPct, stopLossPct: config.exit.stopLossPct },
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
