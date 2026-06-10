import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  clearPosition,
  getPosition,
  listWatch,
  setExitAck,
  setPosition,
  updatePositionConfig,
} from "../store/db.js";
import { normalizeSymbol } from "../symbols.js";
import { requestTick } from "../realtime/loop.js";

const setBody = z.object({
  entryPrice: z.number().positive(),
  shares: z.number().positive().nullable().optional(),
});

// thresholds are fractions: 0.02 = 2%, 0.03 = 3%; null resets to the default
// (trailing default = ATR-adaptive, stop-loss default = global env value)
const configBody = z.object({
  trailPct: z.number().positive().max(0.2).nullable().optional(),
  stopLossPct: z.number().positive().max(0.5).nullable().optional(),
});

const ackBody = z.object({
  acknowledged: z.boolean().optional(),
});

export function registerPositionRoutes(app: FastifyInstance): void {
  // Set entry price -> starts the exit-condition engine.
  app.post<{ Params: { symbol: string } }>("/api/positions/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    if (!listWatch().some((w) => w.symbol === symbol))
      return reply.code(400).send({ error: "请先把该股票加入自选" });

    const parsed = setBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "进场价无效" });

    const pos = setPosition(symbol, parsed.data.entryPrice, parsed.data.shares ?? null);
    requestTick();
    return { position: pos };
  });

  app.get<{ Params: { symbol: string } }>("/api/positions/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    return { position: getPosition(symbol) };
  });

  // Per-stock exit thresholds (trailing take-profit / stop-loss), keeps tracking state.
  app.post<{ Params: { symbol: string } }>(
    "/api/positions/:symbol/exit-config",
    async (req, reply) => {
      const symbol = normalizeSymbol(req.params.symbol);
      if (!symbol) return reply.code(400).send({ error: "无效代码" });

      const cur = getPosition(symbol);
      if (!cur) return reply.code(400).send({ error: "请先设置进场价" });

      const parsed = configBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "指标参数无效" });

      const pos = updatePositionConfig(
        symbol,
        parsed.data.trailPct !== undefined ? parsed.data.trailPct : cur.trailPct,
        parsed.data.stopLossPct !== undefined ? parsed.data.stopLossPct : cur.stopLossPct
      );
      requestTick();
      return { position: pos };
    }
  );

  // Acknowledge (dismiss) the current warning; re-alerts when the state changes again.
  app.post<{ Params: { symbol: string } }>("/api/positions/:symbol/ack", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    if (!getPosition(symbol)) return reply.code(400).send({ error: "该股票暂无持仓跟踪" });

    const parsed = ackBody.safeParse(req.body ?? {});
    const ack = parsed.success ? (parsed.data.acknowledged ?? true) : true;
    setExitAck(symbol, ack);
    requestTick();
    return { ok: true, acknowledged: ack };
  });

  // User clicked "已离场" (sold). Clears position + exit tracking.
  app.post<{ Params: { symbol: string } }>("/api/positions/:symbol/exit", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    clearPosition(symbol);
    requestTick();
    return { ok: true };
  });

  app.delete<{ Params: { symbol: string } }>("/api/positions/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    clearPosition(symbol);
    requestTick();
    return { ok: true };
  });
}
