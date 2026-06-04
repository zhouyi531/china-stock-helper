import "dotenv/config";
import path from "node:path";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

export const config = {
  port: num("PORT", 8787),

  poll: {
    quoteMs: num("QUOTE_POLL_MS", 3000),
    regimeMs: num("REGIME_POLL_MS", 15000),
    sectorMs: num("SECTOR_POLL_MS", 30000),
  },

  exit: {
    trailPct: num("EXIT_TRAIL_PCT", 0.0015),
    stopLossPct: num("EXIT_STOPLOSS_PCT", 0.03),
  },

  // If password is set, the whole site (page + API + WS) requires HTTP Basic Auth.
  auth: {
    username: str("APP_USERNAME", "admin"),
    password: str("APP_PASSWORD", ""),
  },

  openai: {
    apiKey: str("OPENAI_API_KEY", ""),
    baseUrl: str("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    model: str("OPENAI_MODEL", "gpt-4.1"),
    promptCacheKey: str("OPENAI_PROMPT_CACHE_KEY", "a-shares-helper-v1"),
  },

  tushareToken: str("TUSHARE_TOKEN", ""),

  dbPath: path.resolve(process.cwd(), str("DB_PATH", "./data/app.sqlite")),

  // In single-host production the backend also serves the built web UI.
  // Empty => auto-resolve ../../web/dist relative to the server source.
  webDist: str("WEB_DIST", ""),
} as const;

export type Config = typeof config;
