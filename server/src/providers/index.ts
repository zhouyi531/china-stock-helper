import type { Quote, Symbol } from "../types.js";
import { fetchTencentQuotes, fetchTencentDaily, fetchTencentMinute } from "./tencent.js";
import { fetchSinaQuotes } from "./sina.js";

export { fetchTencentDaily as fetchDaily, fetchTencentMinute as fetchMinute };
export type { DailyBar, MinuteBar } from "./tencent.js";

/**
 * Fetch realtime quotes for a set of symbols.
 * Tencent is primary (rich fields). Any symbol Tencent misses is retried via Sina.
 */
export async function fetchQuotes(symbols: Symbol[]): Promise<Map<Symbol, Quote>> {
  if (symbols.length === 0) return new Map();
  let result = new Map<Symbol, Quote>();
  try {
    result = await fetchTencentQuotes(symbols);
  } catch {
    // fall through to Sina for everything
  }

  const missing = symbols.filter((s) => !result.has(s));
  if (missing.length > 0) {
    try {
      const sina = await fetchSinaQuotes(missing);
      for (const [k, v] of sina) result.set(k, v);
    } catch {
      // leave missing; caller marks errors
    }
  }
  return result;
}
