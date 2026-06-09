import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearPosition, getPosition, listWatch, setPosition } from "../store/db.js";
import { normalizeSymbol } from "../symbols.js";

const setBody = z.object({
  entryPrice: z.number().positive(),
  shares: z.number().positive().nullable().optional(),
  // exit overrides as fractions (e.g. 0.0015, 0.03); null -> use server default
  trailPct: z.number().positive().max(1).nullable().optional(),
  stopLossPct: z.number().positive().max(1).nullable().optional(),
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

    const pos = setPosition(
      symbol,
      parsed.data.entryPrice,
      parsed.data.shares ?? null,
      parsed.data.trailPct ?? null,
      parsed.data.stopLossPct ?? null
    );
    return { position: pos };
  });

  app.get<{ Params: { symbol: string } }>("/api/positions/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    return { position: getPosition(symbol) };
  });

  // User clicked "已离场" (sold). Clears position + exit tracking.
  app.post<{ Params: { symbol: string } }>("/api/positions/:symbol/exit", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    clearPosition(symbol);
    return { ok: true };
  });

  app.delete<{ Params: { symbol: string } }>("/api/positions/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    clearPosition(symbol);
    return { ok: true };
  });
}
