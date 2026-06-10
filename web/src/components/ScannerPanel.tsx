import { useCallback, useEffect, useState } from "react";
import type { ScanResult } from "../types";
import { addStock, getScan } from "../api/rest";
import { cls, fmt, fmtAmount, fmtPct, timeAgo, upDownClass } from "../lib/format";

/**
 * 全市场扫描：从沪深全A里筛出"正在走强且仍可介入"的候选。
 * server-side filters: 非ST、价≥2、额≥2亿、涨1%~未及涨停、量比≥0.8。
 */
export function ScannerPanel({
  open,
  onToggle,
  onSelect,
}: {
  open: boolean;
  onToggle: () => void;
  onSelect: (symbol: string) => void;
}) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const load = useCallback(async (force = false) => {
    setBusy(true);
    setErr(null);
    try {
      setResult(await getScan(force));
    } catch (e: any) {
      setErr(e?.message || "扫描失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (open && !result) void load();
  }, [open, result, load]);

  // refresh periodically while expanded
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => void load(), 90_000);
    return () => clearInterval(id);
  }, [open, load]);

  const onAdd = async (symbol: string, code: string) => {
    try {
      await addStock(code);
      setAdded((s) => new Set(s).add(symbol));
    } catch (e: any) {
      setErr(e?.message || "添加失败");
    }
  };

  return (
    <div className="rounded-lg border border-edge bg-panel">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-panelraised/50"
      >
        <span className="text-sm font-semibold text-slate-200">市场扫描 · 今日候选</span>
        <span className="text-[11px] text-slate-600">
          全市场动量+板块+量能综合评分，仅为信号筛选非建议
        </span>
        {result && (
          <span className="ml-auto text-[11px] text-slate-500">
            {result.candidates.length} 个候选 / 扫描 {result.scanned} 只 · {timeAgo(result.ts)}
          </span>
        )}
        <span className="text-slate-500">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-edge px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            {result?.regimeNote && (
              <span
                className={cls(
                  "rounded px-2 py-0.5 text-xs",
                  result.regimeKind === "panic" || result.regimeKind === "weak"
                    ? "bg-down/15 text-down"
                    : result.regimeKind === "strong_trend" || result.regimeKind === "theme"
                      ? "bg-up/15 text-up"
                      : "bg-slate-600/30 text-slate-300"
                )}
              >
                {result.regimeNote}
              </span>
            )}
            <button
              onClick={() => void load(true)}
              disabled={busy}
              className="ml-auto rounded border border-edge px-2 py-1 text-xs text-slate-300 transition hover:bg-panelraised disabled:opacity-50"
            >
              {busy ? "扫描中…" : "立即刷新"}
            </button>
          </div>
          {err && <div className="mb-2 text-xs text-down">{err}</div>}

          {!result && busy ? (
            <div className="py-8 text-center text-sm text-slate-600">全市场扫描中…</div>
          ) : result && result.candidates.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-600">
              当前没有满足条件的候选（市场弱或时段过早）
            </div>
          ) : result ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <td className="px-2 py-1.5">评分</td>
                    <td className="px-2 py-1.5">名称/代码</td>
                    <td className="px-2 py-1.5 text-right">现价</td>
                    <td className="px-2 py-1.5 text-right">涨幅</td>
                    <td className="px-2 py-1.5 text-right">量比</td>
                    <td className="px-2 py-1.5 text-right">换手</td>
                    <td className="px-2 py-1.5 text-right">日内位置</td>
                    <td className="px-2 py-1.5 text-right">成交额</td>
                    <td className="px-2 py-1.5">行业(板块分)</td>
                    <td className="px-2 py-1.5">信号依据</td>
                    <td className="px-2 py-1.5 text-center">操作</td>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {result.candidates.map((c) => (
                    <tr key={c.symbol} className="border-t border-edge/50 hover:bg-panelraised/40">
                      <td className="px-2 py-1.5">
                        <span
                          className={cls(
                            "inline-block min-w-[2.2rem] rounded px-1.5 py-0.5 text-center font-semibold",
                            c.score >= 75
                              ? "bg-up/25 text-up"
                              : c.score >= 65
                                ? "bg-up/15 text-up"
                                : "bg-slate-600/30 text-slate-300"
                          )}
                        >
                          {fmt(c.score, 0)}
                        </span>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-slate-200">{c.name}</div>
                        <div className="text-[10px] text-slate-600">{c.symbol}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-200">{fmt(c.price, 2)}</td>
                      <td className={cls("px-2 py-1.5 text-right", upDownClass(c.pctChange))}>
                        {fmtPct(c.pctChange)}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-300">
                        {c.volumeRatio != null ? fmt(c.volumeRatio, 1) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-300">
                        {c.turnoverRate != null ? `${fmt(c.turnoverRate, 1)}%` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-300">
                        {c.dayRangePos != null ? fmt(c.dayRangePos, 0) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-300">{fmtAmount(c.amount)}</td>
                      <td className="px-2 py-1.5">
                        {c.industry ? (
                          <span className="text-slate-300">
                            {c.industry}
                            {c.industryScore != null && (
                              <span className="ml-1 text-[10px] text-slate-500">
                                {fmt(c.industryScore, 0)}
                                {c.industryRank != null && ` #${c.industryRank}`}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="max-w-[260px] px-2 py-1.5">
                        <div className="truncate text-slate-400" title={[...c.reasons, ...c.warnings].join("；")}>
                          {c.reasons.join("、") || "—"}
                        </div>
                        {c.warnings.length > 0 && (
                          <div className="truncate text-[10px] text-amber-400/80" title={c.warnings.join("；")}>
                            ⚠ {c.warnings.join("、")}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {c.inWatchlist || added.has(c.symbol) ? (
                          <button
                            onClick={() => onSelect(c.symbol)}
                            className="rounded border border-edge px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-panelraised"
                          >
                            已自选·查看
                          </button>
                        ) : (
                          <button
                            onClick={() => void onAdd(c.symbol, c.code)}
                            className="rounded bg-sky-600/80 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-sky-500"
                          >
                            ＋自选
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
