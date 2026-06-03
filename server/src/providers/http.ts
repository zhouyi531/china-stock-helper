import iconv from "iconv-lite";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "*/*",
};

export interface FetchOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function rawFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
  try {
    return await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** Fetch and decode a (possibly GBK-encoded) text body. */
export async function fetchText(
  url: string,
  encoding: "utf-8" | "gbk" = "utf-8",
  opts: FetchOpts = {}
): Promise<string> {
  const res = await rawFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return encoding === "gbk" ? iconv.decode(buf, "gbk") : buf.toString("utf-8");
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOpts = {}
): Promise<T> {
  const text = await fetchText(url, "utf-8", opts);
  return JSON.parse(text) as T;
}

export function toNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}
