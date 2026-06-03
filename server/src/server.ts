import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import fstatic from "@fastify/static";
import { config } from "./config.js";
import { appState } from "./state.js";
import { hub } from "./realtime/hub.js";
import { startRealtime } from "./realtime/loop.js";
import { registerWatchlistRoutes } from "./routes/watchlist.js";
import { registerPositionRoutes } from "./routes/positions.js";
import { registerMarketRoutes } from "./routes/market.js";
import { registerAiRoutes } from "./routes/ai.js";

const app = Fastify({ logger: { level: "info" } });

await app.register(cors, { origin: true });
await app.register(websocket);

registerMarketRoutes(app);
registerWatchlistRoutes(app);
registerPositionRoutes(app);
registerAiRoutes(app);

app.get("/ws", { websocket: true }, (socket) => {
  hub.add(socket);
  if (appState.latestSnapshot) {
    hub.send(socket, { type: "snapshot", data: appState.latestSnapshot });
  }
});

// Single-host production: serve the built web UI from the same origin so the
// SPA reaches /api and /ws without CORS or a separate web server.
const here = path.dirname(fileURLToPath(import.meta.url));
const webDist = config.webDist || path.resolve(here, "..", "..", "web", "dist");
if (fs.existsSync(path.join(webDist, "index.html"))) {
  await app.register(fstatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api") || req.url.startsWith("/ws")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.sendFile("index.html");
  });
  app.log.info(`Serving web UI from ${webDist}`);
} else {
  app.log.info(`Web UI bundle not found at ${webDist} (dev mode: run Vite separately)`);
}

const stop = startRealtime();

const shutdown = async () => {
  stop();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

app
  .listen({ port: config.port, host: "0.0.0.0" })
  .then((addr) => app.log.info(`A-shares helper server listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
