import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { addWatch, listWatch, removeWatch, setWatchPinned } from "../store/db.js";
import { fetchQuotes } from "../providers/index.js";
import { normalizeSymbol } from "../symbols.js";
import { sectorService } from "../sector/layer3.js";
import { requestTick } from "../realtime/loop.js";

const addBody = z.object({ code: z.string().min(1) });

export function registerWatchlistRoutes(app: FastifyInstance): void {
  app.get("/api/watchlist", async () => {
    return { items: listWatch() };
  });

  app.post("/api/watchlist", async (req, reply) => {
    const parsed = addBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "缺少股票代码" });

    const symbol = normalizeSymbol(parsed.data.code);
    if (!symbol) return reply.code(400).send({ error: "无法识别的股票代码" });

    // Validate the symbol resolves to a real quote and capture its name.
    let name = "";
    try {
      const quotes = await fetchQuotes([symbol]);
      const q = quotes.get(symbol);
      if (!q) return reply.code(404).send({ error: "未找到该股票行情，请检查代码" });
      name = q.name;
    } catch {
      return reply.code(502).send({ error: "行情源暂不可用，稍后重试" });
    }

    addWatch(symbol, name);
    // warm up the Layer-3 binding in the background
    sectorService.ensureBinding(symbol).catch(() => {});
    return { symbol, name };
  });

  const pinBody = z.object({ pinned: z.boolean() });

  app.post<{ Params: { symbol: string } }>("/api/watchlist/:symbol/pin", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    const parsed = pinBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "缺少 pinned 字段" });
    if (!setWatchPinned(symbol, parsed.data.pinned)) {
      return reply.code(404).send({ error: "该股票不在自选列表中" });
    }
    requestTick();
    return { ok: true, pinned: parsed.data.pinned };
  });

  app.delete<{ Params: { symbol: string } }>("/api/watchlist/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    removeWatch(symbol);
    return { ok: true };
  });
}
