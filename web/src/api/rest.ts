import type {
  AiAnalysisRecord,
  BacktestResult,
  BacktestStrategy,
  FullSnapshot,
  KlineResponse,
  ScanResult,
} from "../types";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as any)?.error || `请求失败 (${res.status})`);
  }
  return body as T;
}

export async function getSnapshot(): Promise<FullSnapshot> {
  return jsonOrThrow(await fetch("/api/snapshot"));
}

export async function addStock(code: string): Promise<{ symbol: string; name: string }> {
  return jsonOrThrow(
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
  );
}

export async function removeStock(symbol: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/watchlist/${symbol}`, { method: "DELETE" }));
}

/** Pin / unpin a stock to the top of the watchlist. */
export async function setPinned(symbol: string, pinned: boolean): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/watchlist/${symbol}/pin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    })
  );
}

export async function setPosition(
  symbol: string,
  entryPrice: number,
  shares?: number | null,
  trailPct?: number | null,
  stopLossPct?: number | null
): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/positions/${symbol}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entryPrice,
        shares: shares ?? null,
        trailPct: trailPct ?? null,
        stopLossPct: stopLossPct ?? null,
      }),
    })
  );
}

export async function exitPosition(symbol: string): Promise<void> {
  await jsonOrThrow(await fetch(`/api/positions/${symbol}/exit`, { method: "POST" }));
}

/** Dismiss (or re-arm) the current exit warning for a stock. */
export async function ackAlert(symbol: string, acknowledged = true): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/positions/${symbol}/ack`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledged }),
    })
  );
}

/** Per-stock exit thresholds (fractions, e.g. 0.0015 = 0.15%); null resets to default. */
export async function setExitConfig(
  symbol: string,
  trailPct: number | null,
  stopLossPct: number | null
): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/positions/${symbol}/exit-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trailPct, stopLossPct }),
    })
  );
}

export async function getKline(symbol: string): Promise<KlineResponse> {
  return jsonOrThrow(await fetch(`/api/kline/${symbol}`));
}

export async function getAiHistory(symbol: string): Promise<AiAnalysisRecord[]> {
  const r = await jsonOrThrow<{ items: AiAnalysisRecord[] }>(
    await fetch(`/api/ai/${symbol}/history`)
  );
  return r.items;
}

/** Whole-market opportunity scan (cached 60s server-side). */
export async function getScan(force = false): Promise<ScanResult> {
  return jsonOrThrow(await fetch(`/api/scan${force ? "?force=1" : ""}`));
}

/** Daily-bar backtest with trailing-stop parameter sweep. */
export async function getBacktest(
  symbol: string,
  strategy: BacktestStrategy,
  trail: number,
  stop: number
): Promise<BacktestResult> {
  const qs = new URLSearchParams({
    strategy,
    trail: String(trail),
    stop: String(stop),
  });
  return jsonOrThrow(await fetch(`/api/backtest/${symbol}?${qs}`));
}
