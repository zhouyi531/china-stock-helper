import type { FullSnapshot, Regime, StockSnapshot, Symbol } from "./types.js";

/**
 * Mutable in-memory application state, written by the realtime loop and read by
 * REST routes / websocket. Keeps the latest computed snapshot so HTTP clients and
 * new websocket connections can be served instantly.
 */
class AppState {
  latestSnapshot: FullSnapshot | null = null;
  latestRegime: Regime | null = null;

  getStock(symbol: Symbol): StockSnapshot | null {
    return this.latestSnapshot?.stocks.find((s) => s.symbol === symbol) ?? null;
  }
}

export const appState = new AppState();
