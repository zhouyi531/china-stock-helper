import type { SectorBoard, SectorRef, StockSectorInfo, Symbol } from "../types.js";
import {
  fetchEastMoneyBoards,
  fetchEastMoneyStockBinding,
  fetchEastMoneyZTPool,
} from "../providers/eastmoney.js";
import { clamp, round } from "../util/math.js";

interface WeightedComponent {
  val: number | null;
  w: number;
}

/** Weighted average over the available (non-null) components, weights renormalised. */
function weightedScore(components: WeightedComponent[]): number {
  let sum = 0;
  let wsum = 0;
  for (const c of components) {
    if (c.val == null) continue;
    sum += c.val * c.w;
    wsum += c.w;
  }
  if (wsum <= 0) return 0;
  return round(clamp(sum / wsum, 0, 100), 1);
}

/**
 * Score boards of one type (per docs/参数建议.txt):
 *   rank 30% + 成交额分位 25% + 上涨比例 20% + 涨停数 15% + 龙头强度 10%
 * 涨停数 now comes from the live 涨停池 (was always missing before).
 */
function scoreBoards(boards: SectorBoard[]): SectorBoard[] {
  if (boards.length === 0) return boards;
  const amounts = boards.map((b) => b.amount).sort((a, b) => a - b);
  const total = boards.length;
  for (const b of boards) {
    const rankScore = ((total - b.rank + 1) / total) * 100;
    // amount percentile within the same board type as a proxy for 成交额放大
    const idx = amounts.findIndex((a) => a >= b.amount);
    const amountPct = total > 1 ? (idx / (total - 1)) * 100 : 50;
    const upScore = b.upRatio != null ? b.upRatio * 100 : null;
    const limitScore =
      b.limitUpCount != null ? (clamp(b.limitUpCount, 0, 15) / 15) * 100 : null;
    const leaderScore =
      b.leaderStrength != null ? (clamp(b.leaderStrength, 0, 12) / 12) * 100 : null;
    b.score = weightedScore([
      { val: rankScore, w: 0.3 },
      { val: amountPct, w: 0.25 },
      { val: upScore, w: 0.2 },
      { val: limitScore, w: 0.15 },
      { val: leaderScore, w: 0.1 },
    ]);
  }
  return boards;
}

interface Binding {
  industryName: string | null;
  concepts: SectorRef[];
  available: boolean;
  ts: number;
}

const BINDING_TTL = 6 * 60 * 60 * 1000; // 6h

class SectorService {
  private industry: SectorBoard[] = [];
  private concept: SectorBoard[] = [];
  private industryByName = new Map<string, SectorBoard>();
  private conceptByName = new Map<string, SectorBoard>();
  private bindings = new Map<Symbol, Binding>();
  private lastRefresh = 0;
  available = false;

  /** Refresh industry + concept board lists, inject 涨停池 counts, recompute scores. */
  async refresh(): Promise<void> {
    try {
      const [ind, con, ztPool] = await Promise.all([
        fetchEastMoneyBoards("industry"),
        fetchEastMoneyBoards("concept"),
        fetchEastMoneyZTPool(),
      ]);

      // per-industry limit-up count + max 连板 height from the live pool
      if (ztPool.available && ind.length) {
        const counts = new Map<string, { n: number; maxStreak: number }>();
        for (const item of ztPool.items) {
          if (!item.industry) continue;
          const cur = counts.get(item.industry) ?? { n: 0, maxStreak: 0 };
          cur.n += 1;
          cur.maxStreak = Math.max(cur.maxStreak, item.streak);
          counts.set(item.industry, cur);
        }
        for (const b of ind) {
          const c = counts.get(b.name);
          b.limitUpCount = c ? c.n : 0;
          b.maxLimitStreak = c ? c.maxStreak : 0;
        }
      }

      if (ind.length) this.industry = scoreBoards(ind);
      if (con.length) this.concept = scoreBoards(con);
      this.industryByName.clear();
      this.conceptByName.clear();
      for (const b of this.industry) this.industryByName.set(b.name, b);
      for (const b of this.concept) this.conceptByName.set(b.name, b);
      this.available = this.industry.length > 0;
      this.lastRefresh = Date.now();
    } catch {
      // keep last good data
    }
  }

  getBoards(): { industry: SectorBoard[]; concept: SectorBoard[]; available: boolean } {
    return { industry: this.industry, concept: this.concept, available: this.available };
  }

  /** Industry board lookup by exact name (used by the scanner). */
  getIndustryByName(name: string | null | undefined): SectorBoard | null {
    if (!name) return null;
    return this.industryByName.get(name) ?? null;
  }

  /** Fetch + cache a stock's industry/concept binding when missing or stale. */
  async ensureBinding(symbol: Symbol): Promise<void> {
    const cur = this.bindings.get(symbol);
    if (cur && Date.now() - cur.ts < BINDING_TTL && cur.available) return;
    const b = await fetchEastMoneyStockBinding(symbol);
    this.bindings.set(symbol, { ...b, ts: Date.now() });
  }

  getStockSector(symbol: Symbol): StockSectorInfo {
    const binding = this.bindings.get(symbol);
    if (!binding || !binding.available || !binding.industryName) {
      return {
        industry: null,
        concepts: binding?.concepts ?? [],
        sectorScore: 0,
        conceptScore: null,
        available: false,
      };
    }
    const board = this.industryByName.get(binding.industryName) ?? null;

    // best matching concept board score (concept labels don't always map 1:1)
    let conceptScore: number | null = null;
    for (const c of binding.concepts) {
      const cb = this.conceptByName.get(c.name);
      if (cb && (conceptScore == null || cb.score > conceptScore)) conceptScore = cb.score;
    }

    return {
      industry: board,
      concepts: binding.concepts,
      sectorScore: board?.score ?? 0,
      conceptScore,
      available: board != null,
    };
  }
}

export const sectorService = new SectorService();
