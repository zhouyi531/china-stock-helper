import type { Market, Symbol } from "./types.js";

/** Infer the exchange for a 6-digit A-share code. */
export function inferMarket(code: string): Market | null {
  if (!/^\d{6}$/.test(code)) return null;
  const p3 = code.slice(0, 3);
  const p2 = code.slice(0, 2);
  // Shanghai: 60x main board, 688/689 STAR
  if (p2 === "60" || p3 === "688" || p3 === "689" || p3 === "900") return "sh";
  // Shenzhen: 000/001/002/003 main+SME, 300/301 ChiNext, 200 B-share
  if (
    p3 === "000" ||
    p3 === "001" ||
    p3 === "002" ||
    p3 === "003" ||
    p3 === "300" ||
    p3 === "301" ||
    p3 === "200"
  )
    return "sz";
  // Beijing exchange
  if (["43", "83", "87", "88", "92"].includes(p2) || p3 === "920") return "bj";
  return null;
}

/**
 * Normalise arbitrary user input to a fully-qualified symbol "sh600000".
 * Accepts: "600000", "sh600000", "SH600000", "600000.SH", "sz000001".
 */
export function normalizeSymbol(input: string): Symbol | null {
  if (!input) return null;
  let s = input.trim().toLowerCase().replace(/\s+/g, "");
  // "600000.sh" -> "sh600000"
  const dot = s.match(/^(\d{6})\.(sh|sz|bj)$/);
  if (dot) return `${dot[2]}${dot[1]}`;
  // already "sh600000"
  const pref = s.match(/^(sh|sz|bj)(\d{6})$/);
  if (pref) return `${pref[1]}${pref[2]}`;
  // bare 6-digit code: infer
  if (/^\d{6}$/.test(s)) {
    const m = inferMarket(s);
    return m ? `${m}${s}` : null;
  }
  return null;
}

export function splitSymbol(symbol: Symbol): { market: Market; code: string } {
  const market = symbol.slice(0, 2) as Market;
  const code = symbol.slice(2);
  return { market, code };
}

/** East Money secid: 1.600000 (sh) / 0.000001 (sz) / market id for bj is 0 too in practice. */
export function toEastMoneySecid(symbol: Symbol): string {
  const { market, code } = splitSymbol(symbol);
  const m = market === "sh" ? 1 : 0;
  return `${m}.${code}`;
}
