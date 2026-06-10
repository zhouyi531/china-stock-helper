import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import type { AiAnalysisRecord, AiMode, ExitStateKind, Position, Symbol } from "../types.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS watchlist (
  symbol     TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
  symbol      TEXT PRIMARY KEY,
  entry_price REAL NOT NULL,
  shares      REAL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exit_state (
  symbol      TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  peak        REAL NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol     TEXT NOT NULL,
  mode       TEXT NOT NULL,
  content    TEXT NOT NULL,
  model      TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_symbol ON ai_analysis(symbol, created_at DESC);
`);

// lightweight migrations for columns added after the initial release
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("positions", "trail_pct", "trail_pct REAL");
ensureColumn("positions", "stop_loss_pct", "stop_loss_pct REAL");
ensureColumn("exit_state", "ack", "ack INTEGER NOT NULL DEFAULT 0");
ensureColumn("watchlist", "pinned", "pinned INTEGER NOT NULL DEFAULT 0");

// ---- Watchlist ----

export interface WatchRow {
  symbol: Symbol;
  name: string;
  sort_order: number;
  pinned: number; // 0/1, user pinned to the top of the list
  created_at: number;
}

export function listWatch(): WatchRow[] {
  return db
    .prepare("SELECT * FROM watchlist ORDER BY sort_order ASC, created_at ASC")
    .all() as WatchRow[];
}

export function addWatch(symbol: Symbol, name: string): void {
  const now = Date.now();
  const maxOrder =
    (db.prepare("SELECT MAX(sort_order) m FROM watchlist").get() as { m: number | null }).m ?? 0;
  db.prepare(
    `INSERT INTO watchlist (symbol, name, sort_order, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET name=excluded.name`
  ).run(symbol, name, maxOrder + 1, now);
}

export function setWatchPinned(symbol: Symbol, pinned: boolean): boolean {
  const res = db
    .prepare("UPDATE watchlist SET pinned=? WHERE symbol=?")
    .run(pinned ? 1 : 0, symbol);
  return res.changes > 0;
}

export function removeWatch(symbol: Symbol): void {
  const tx = db.transaction((s: string) => {
    db.prepare("DELETE FROM watchlist WHERE symbol=?").run(s);
    db.prepare("DELETE FROM positions WHERE symbol=?").run(s);
    db.prepare("DELETE FROM exit_state WHERE symbol=?").run(s);
  });
  tx(symbol);
}

export function updateWatchName(symbol: Symbol, name: string): void {
  db.prepare("UPDATE watchlist SET name=? WHERE symbol=? AND (name='' OR name IS NULL)").run(
    name,
    symbol
  );
}

// ---- Positions ----

interface PosRow {
  symbol: Symbol;
  entry_price: number;
  shares: number | null;
  trail_pct: number | null;
  stop_loss_pct: number | null;
  created_at: number;
}

function toPosition(r: PosRow): Position {
  return {
    symbol: r.symbol,
    entryPrice: r.entry_price,
    shares: r.shares,
    trailPct: r.trail_pct,
    stopLossPct: r.stop_loss_pct,
    createdAt: r.created_at,
  };
}

export function getPosition(symbol: Symbol): Position | null {
  const r = db.prepare("SELECT * FROM positions WHERE symbol=?").get(symbol) as PosRow | undefined;
  return r ? toPosition(r) : null;
}

export function listPositions(): Position[] {
  return (db.prepare("SELECT * FROM positions").all() as PosRow[]).map(toPosition);
}

export function setPosition(symbol: Symbol, entryPrice: number, shares: number | null): Position {
  const now = Date.now();
  const existing = getPosition(symbol);
  db.prepare(
    `INSERT INTO positions (symbol, entry_price, shares, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET entry_price=excluded.entry_price, shares=excluded.shares`
  ).run(symbol, entryPrice, shares, now);
  // a changed entry price restarts exit tracking; editing only the share
  // count keeps the tracked peak (trailing-stop high watermark) intact
  if (!existing || existing.entryPrice !== entryPrice) {
    db.prepare("DELETE FROM exit_state WHERE symbol=?").run(symbol);
  }
  return getPosition(symbol)!;
}

/**
 * Update per-stock exit thresholds without restarting exit tracking.
 * Passing null resets a threshold to the global default. Any pending
 * warning acknowledgement is cleared so the new thresholds re-alert.
 */
export function updatePositionConfig(
  symbol: Symbol,
  trailPct: number | null,
  stopLossPct: number | null
): Position | null {
  const tx = db.transaction((s: string) => {
    db.prepare("UPDATE positions SET trail_pct=?, stop_loss_pct=? WHERE symbol=?").run(
      trailPct,
      stopLossPct,
      s
    );
    db.prepare("UPDATE exit_state SET ack=0 WHERE symbol=?").run(s);
  });
  tx(symbol);
  return getPosition(symbol);
}

export function clearPosition(symbol: Symbol): void {
  const tx = db.transaction((s: string) => {
    db.prepare("DELETE FROM positions WHERE symbol=?").run(s);
    db.prepare("DELETE FROM exit_state WHERE symbol=?").run(s);
  });
  tx(symbol);
}

// ---- Exit state (persisted across restarts) ----

export interface ExitRow {
  symbol: Symbol;
  kind: ExitStateKind;
  peak: number;
  ack: number; // 0/1, warning acknowledged by the user
  updated_at: number;
}

export function getExitRow(symbol: Symbol): ExitRow | null {
  return (db.prepare("SELECT * FROM exit_state WHERE symbol=?").get(symbol) as ExitRow) ?? null;
}

export function saveExitRow(
  symbol: Symbol,
  kind: ExitStateKind,
  peak: number,
  ack: boolean
): void {
  db.prepare(
    `INSERT INTO exit_state (symbol, kind, peak, ack, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET kind=excluded.kind, peak=excluded.peak, ack=excluded.ack, updated_at=excluded.updated_at`
  ).run(symbol, kind, peak, ack ? 1 : 0, Date.now());
}

/** Mark the current warning as acknowledged (or re-arm it). */
export function setExitAck(symbol: Symbol, ack: boolean): void {
  db.prepare("UPDATE exit_state SET ack=?, updated_at=? WHERE symbol=?").run(
    ack ? 1 : 0,
    Date.now(),
    symbol
  );
}

// ---- AI analysis history ----

interface AiRow {
  id: number;
  symbol: Symbol;
  mode: string;
  content: string;
  model: string;
  created_at: number;
}

export function addAnalysis(symbol: Symbol, mode: AiMode, content: string, model: string): number {
  const info = db
    .prepare(
      "INSERT INTO ai_analysis (symbol, mode, content, model, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(symbol, mode, content, model, Date.now());
  return Number(info.lastInsertRowid);
}

export function listAnalyses(symbol: Symbol, limit = 10): AiAnalysisRecord[] {
  const rows = db
    .prepare("SELECT * FROM ai_analysis WHERE symbol=? ORDER BY created_at DESC LIMIT ?")
    .all(symbol, limit) as AiRow[];
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    mode: r.mode as AiMode,
    content: r.content,
    model: r.model,
    createdAt: r.created_at,
  }));
}
