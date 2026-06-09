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

// Per-position exit overrides, added after the initial release. ALTER throws if
// the column already exists, so guard each one for idempotent startup.
for (const col of ["trail_pct", "stop_loss_pct"]) {
  try {
    db.exec(`ALTER TABLE positions ADD COLUMN ${col} REAL`);
  } catch {
    // column already present
  }
}

// ---- Watchlist ----

export interface WatchRow {
  symbol: Symbol;
  name: string;
  sort_order: number;
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
    trailPct: r.trail_pct ?? config.exit.trailPct,
    stopLossPct: r.stop_loss_pct ?? config.exit.stopLossPct,
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

export function setPosition(
  symbol: Symbol,
  entryPrice: number,
  shares: number | null,
  trailPct: number | null = null,
  stopLossPct: number | null = null
): Position {
  const now = Date.now();
  const prev = getPosition(symbol);
  db.prepare(
    `INSERT INTO positions (symbol, entry_price, shares, trail_pct, stop_loss_pct, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       entry_price=excluded.entry_price,
       shares=excluded.shares,
       trail_pct=excluded.trail_pct,
       stop_loss_pct=excluded.stop_loss_pct`
  ).run(symbol, entryPrice, shares, trailPct, stopLossPct, now);
  // Reset peak tracking only when the entry price changes; editing the stop
  // ratios alone should preserve the recorded peak.
  if (!prev || prev.entryPrice !== entryPrice) {
    db.prepare("DELETE FROM exit_state WHERE symbol=?").run(symbol);
  }
  return getPosition(symbol)!;
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
  updated_at: number;
}

export function getExitRow(symbol: Symbol): ExitRow | null {
  return (db.prepare("SELECT * FROM exit_state WHERE symbol=?").get(symbol) as ExitRow) ?? null;
}

export function saveExitRow(symbol: Symbol, kind: ExitStateKind, peak: number): void {
  db.prepare(
    `INSERT INTO exit_state (symbol, kind, peak, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET kind=excluded.kind, peak=excluded.peak, updated_at=excluded.updated_at`
  ).run(symbol, kind, peak, Date.now());
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
