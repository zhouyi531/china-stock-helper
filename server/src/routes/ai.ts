import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { appState } from "../state.js";
import { normalizeSymbol } from "../symbols.js";
import { getMarketClock, sessionVolumeFraction } from "../marketClock.js";
import { fetchQuotes, fetchDaily } from "../providers/index.js";
import { shanghaiDateIso } from "../providers/eastmoney.js";
import { computeLayer1 } from "../indicators/layer1.js";
import { sectorService } from "../sector/layer3.js";
import { computeDecision } from "../decision/engine.js";
import { stepExit } from "../exit/engine.js";
import { effectiveExitConfig } from "../realtime/loop.js";
import { addAnalysis, getExitRow, getPosition, listAnalyses } from "../store/db.js";
import { STATIC_PREFIX, buildDynamicPayload } from "../ai/prompt.js";
import { streamResponses } from "../ai/openai.js";
import type { AiMode, StockSnapshot, Symbol } from "../types.js";

/** Prefer the live snapshot; fall back to an on-demand read-only build. */
async function getStockForAi(symbol: Symbol): Promise<StockSnapshot | null> {
  const cur = appState.getStock(symbol);
  if (cur && cur.quote) return cur;

  const quotes = await fetchQuotes([symbol]).catch(() => new Map());
  const q = quotes.get(symbol);
  if (!q) return cur ?? null;

  const clock = getMarketClock();
  const daily = await fetchDaily(symbol, 160).catch(() => []);
  const layer1 = computeLayer1(q, {
    daily,
    ticks: [{ t: Date.now(), price: q.price }],
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
      q.price,
      effectiveExitConfig(position, layer1)
    );
    st.symbol = symbol;
    st.acknowledged = prev != null && prev.kind === st.kind && prev.ack === 1;
    exit = st;
  }
  const decision = computeDecision({
    quote: q,
    layer1,
    sector,
    regime: appState.latestRegime,
    position,
    exit,
    clock,
  });
  return {
    symbol,
    code: symbol.slice(2),
    name: q.name,
    market: symbol.slice(0, 2) as StockSnapshot["market"],
    quote: q,
    layer1,
    sector,
    decision,
    position,
    exit,
  };
}

export function registerAiRoutes(app: FastifyInstance): void {
  app.get<{ Params: { symbol: string } }>("/api/ai/:symbol/history", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });
    return { items: listAnalyses(symbol, 10) };
  });

  app.post<{ Params: { symbol: string } }>("/api/ai/:symbol", async (req, reply) => {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!symbol) return reply.code(400).send({ error: "无效代码" });

    const stock = await getStockForAi(symbol);
    if (!stock || !stock.quote) {
      return reply.code(503).send({ error: "行情数据加载中，请稍候重试" });
    }

    const mode: AiMode = stock.position ? "exit" : "entry";
    const dynamic = buildDynamicPayload(stock, appState.latestRegime, mode);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    raw.write(`event: meta\ndata: ${JSON.stringify({ mode, model: config.openai.model, symbol })}\n\n`);

    let full = "";
    try {
      for await (const delta of streamResponses(STATIC_PREFIX, dynamic)) {
        full += delta;
        raw.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      const id = full ? addAnalysis(symbol, mode, full, config.openai.model) : 0;
      raw.write(`event: done\ndata: ${JSON.stringify({ id, length: full.length })}\n\n`);
    } catch (e: any) {
      raw.write(`event: error\ndata: ${JSON.stringify({ error: e?.message || "AI 调用失败" })}\n\n`);
    } finally {
      raw.end();
    }
  });
}
