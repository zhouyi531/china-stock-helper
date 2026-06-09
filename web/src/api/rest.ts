import type { AiAnalysisRecord, FullSnapshot, KlineResponse } from "../types";

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

export async function getKline(symbol: string): Promise<KlineResponse> {
  return jsonOrThrow(await fetch(`/api/kline/${symbol}`));
}

export async function getAiHistory(symbol: string): Promise<AiAnalysisRecord[]> {
  const r = await jsonOrThrow<{ items: AiAnalysisRecord[] }>(
    await fetch(`/api/ai/${symbol}/history`)
  );
  return r.items;
}
