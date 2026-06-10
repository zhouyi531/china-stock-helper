import type { ScanCandidate, ScanResult } from "../types.js";
import { fetchEastMoneyScanUniverse, type ScannerRow } from "../providers/eastmoney.js";
import { sectorService } from "../sector/layer3.js";
import { appState } from "../state.js";
import { listWatch } from "../store/db.js";
import { clamp, round } from "../util/math.js";

const SCAN_TTL = 60_000;
let cache: ScanResult | null = null;
let inflight: Promise<ScanResult> | null = null;

/** 20% boards: 创业板 300/301, 科创板 688/689. Everything else scanned is 10%. */
function limitPctOf(code: string): number {
  const p3 = code.slice(0, 3);
  return p3 === "300" || p3 === "301" || p3 === "688" || p3 === "689" ? 20 : 10;
}

interface Scored {
  candidate: ScanCandidate;
  score: number;
}

function scoreRow(row: ScannerRow, watchSet: Set<string>): Scored | null {
  const name = row.name.toUpperCase();
  // hard filters: tradability & junk
  if (name.includes("ST") || name.includes("退")) return null;
  if (row.price < 2) return null;
  if (row.amount < 2e8) return null;
  if (row.pctChange < 1) return null; // momentum scan: must actually be moving
  const limitPct = limitPctOf(row.code);
  if (row.pctChange >= limitPct - 0.5) return null; // at/near limit: can't enter sanely
  if (row.volumeRatio > 0 && row.volumeRatio < 0.8) return null; // shrinking volume rally

  const reasons: string[] = [];
  const warnings: string[] = [];
  let s = 45;

  // % change sweet spot around +4.5%: strong but not exhausted
  s += clamp(12 - Math.abs(row.pctChange - 4.5) * 2.4, 0, 12);

  // position within today's range: closing strong matters
  let dayRangePos: number | null = null;
  if (row.high > row.low && row.low > 0) {
    dayRangePos = clamp(((row.price - row.low) / (row.high - row.low)) * 100, 0, 100);
    if (dayRangePos >= 85) {
      s += 8;
      reasons.push("价格贴近日内高点");
    } else if (dayRangePos >= 70) s += 5;
    else if (dayRangePos <= 35) {
      s -= 6;
      warnings.push("冲高回落，日内位置偏低");
    }
  }

  if (row.open > 0 && row.price > row.open) s += 3;

  // volume expansion
  const vr = row.volumeRatio;
  if (vr >= 1.5) {
    s += clamp(((Math.min(vr, 6) - 1.5) / 4.5) * 10, 0, 10);
    reasons.push(`放量（量比 ${round(vr, 1)}）`);
    if (vr > 8) {
      s -= 2;
      warnings.push("量比异常放大，分歧巨大");
    }
  } else if (vr >= 1) s += 2;
  else if (vr > 0) s -= 4;

  // turnover band
  const t = row.turnoverRate;
  if (t >= 3 && t <= 15) s += 6;
  else if (t >= 1 && t < 3) s += 2;
  else if (t > 25) {
    s -= 5;
    warnings.push(`换手 ${round(t, 1)}% 过高`);
  } else if (t > 0 && t < 1) s -= 5;

  // immediate momentum (涨速)
  s += (clamp(row.speedPct, -1.5, 1.5) / 1.5) * 5;

  // sector strength via live board scores
  const board = sectorService.getIndustryByName(row.industry);
  let industryScore: number | null = null;
  let industryRank: number | null = null;
  if (board) {
    industryScore = board.score;
    industryRank = board.rank;
    s += ((board.score - 50) / 50) * 14;
    if (board.rank <= 5) {
      s += 4;
      reasons.push(`行业「${board.name}」强度榜第${board.rank}`);
    } else if (board.score >= 60) {
      reasons.push(`行业「${board.name}」走强（板块分 ${board.score}）`);
    }
    if ((board.limitUpCount ?? 0) >= 3) reasons.push(`板块内涨停 ${board.limitUpCount} 家`);
  }

  // liquidity comfort
  if (row.amount >= 10e8) s += 4;
  else if (row.amount >= 5e8) s += 2;

  if (row.pctChange >= (limitPct === 20 ? 14 : 7)) {
    warnings.push("今日涨幅已大，注意追高风险");
  }

  const score = clamp(round(s, 1), 0, 100);
  return {
    score,
    candidate: {
      symbol: row.symbol,
      code: row.code,
      name: row.name,
      price: row.price,
      pctChange: round(row.pctChange, 2),
      speedPct: round(row.speedPct, 2),
      volumeRatio: vr > 0 ? round(vr, 2) : null,
      turnoverRate: t > 0 ? round(t, 2) : null,
      amount: row.amount,
      dayRangePos: dayRangePos != null ? round(dayRangePos, 0) : null,
      industry: row.industry,
      industryScore,
      industryRank,
      score,
      reasons: reasons.slice(0, 4),
      warnings: warnings.slice(0, 3),
      inWatchlist: watchSet.has(row.symbol),
    },
  };
}

function regimeNote(): { kind: ScanResult["regimeKind"]; note: string | null } {
  const r = appState.latestRegime;
  if (!r) return { kind: null, note: null };
  switch (r.kind) {
    case "panic":
      return { kind: r.kind, note: "恐慌杀跌市：系统性风险优先，以下仅为强度观察榜，不建议开仓" };
    case "weak":
      return { kind: r.kind, note: "弱势市：逆势股风险高，仅供观察、严控仓位" };
    case "low_volume":
      return { kind: r.kind, note: "缩量市：突破假信号多，候选需额外等待量能确认" };
    case "theme":
      return { kind: r.kind, note: "题材情绪市：优先关注涨停梯队完整、板块分高的方向" };
    case "strong_trend":
      return { kind: r.kind, note: "强趋势市：顺势而为，强者恒强" };
    default:
      return { kind: r.kind, note: null };
  }
}

async function runScan(): Promise<ScanResult> {
  const universe = await fetchEastMoneyScanUniverse();
  const watchSet = new Set(listWatch().map((w) => w.symbol));
  const scored: Scored[] = [];
  for (const row of universe) {
    const s = scoreRow(row, watchSet);
    if (s) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score);
  const { kind, note } = regimeNote();
  return {
    candidates: scored.slice(0, 20).map((s) => s.candidate),
    scanned: scored.length,
    regimeKind: kind,
    regimeNote: note,
    ts: Date.now(),
  };
}

/** Cached scan (60s TTL); concurrent callers share one in-flight request. */
export async function getScan(force = false): Promise<ScanResult> {
  if (!force && cache && Date.now() - cache.ts < SCAN_TTL) return cache;
  if (inflight) return inflight;
  inflight = runScan()
    .then((r) => {
      cache = r;
      return r;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
