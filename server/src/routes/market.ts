import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { appState } from "../state.js";
import { getMarketClock } from "../marketClock.js";
import { sectorService } from "../sector/layer3.js";
import { fetchDaily, fetchMinute, type DailyBar, type MinuteBar } from "../providers/index.js";
import { normalizeSymbol } from "../symbols.js";
import { sma } from "../util/math.js";

interface KlineCacheEntry {
  ts: number;
  daily: DailyBar[];
  minute: MinuteBar[];
}
const klineCache = new Map<string, KlineCacheEntry>();
const KLINE_TTL = 20_000;

export function registerMarketRoutes(app: FastifyInstance): void {
  app.get("/api/health", async () => ({ ok: true, ts: Date.now() }));

  app.get("/api/clock", async () => getMarketClock());

  app.get("/api/snapshot", async () => {
    return (
      appState.latestSnapshot ?? {
        clock: getMarketClock(),
        stocks: [],
        regime: null,
        exitDefaults: { trailPct: config.exit.trailPct, stopLossPct: config.exit.stopLossPct },
        ts: Date.now(),
      }
    );
  });

  app.get("/api/regime", async () => appState.latestRegime);

  app.get("/api/sectors", async () => sectorService.getBoards());

  app.get<{ Params: { symbol: string } }>("/api/kline/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });

    const cached = klineCache.get(symbol);
    let daily: DailyBar[];
    let minute: MinuteBar[];
    if (cached && Date.now() - cached.ts < KLINE_TTL) {
      daily = cached.daily;
      minute = cached.minute;
    } else {
      [daily, minute] = await Promise.all([
        fetchDaily(symbol, 120).catch(() => [] as DailyBar[]),
        fetchMinute(symbol).catch(() => [] as MinuteBar[]),
      ]);
      klineCache.set(symbol, { ts: Date.now(), daily, minute });
    }

    const closes = daily.map((b) => b.close);
    const ma = daily.map((_, i) => {
      const slice = closes.slice(0, i + 1);
      return {
        ma5: sma(slice, 5),
        ma10: sma(slice, 10),
        ma20: sma(slice, 20),
      };
    });

    return { symbol, daily, minute, ma };
  });
}
