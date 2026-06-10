import type { Decision } from "../types";
import { cls, fmt } from "../lib/format";
import { DECISION_BADGE, DECISION_LABEL } from "../lib/exit";

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-up" : score >= 55 ? "bg-amber-400" : score >= 45 ? "bg-slate-400" : "bg-down";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
      <div className={cls("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
    </div>
  );
}

export function DecisionCard({ decision }: { decision: Decision }) {
  const d = decision;
  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-200">综合决策</h3>
          <span className={cls("rounded px-2 py-0.5 text-xs", DECISION_BADGE[d.action])}>
            {DECISION_LABEL[d.action]}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          机会分 <span className="text-sm font-semibold text-slate-200">{fmt(d.score, 0)}</span>/100
          <span className="ml-2">置信度 {fmt(d.confidence, 0)}</span>
        </div>
      </div>

      <ScoreBar score={d.score} />

      {/* checklist */}
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
        {d.checklist.map((c) => (
          <div key={c.key} className="flex items-center gap-1.5 text-xs" title={c.detail}>
            <span
              className={cls(
                "inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] font-bold",
                c.pass === true
                  ? "bg-up/25 text-up"
                  : c.pass === false
                    ? "bg-down/20 text-down"
                    : "bg-slate-600/40 text-slate-400"
              )}
            >
              {c.pass === true ? "✓" : c.pass === false ? "✗" : "?"}
            </span>
            <span className={c.pass === true ? "text-slate-300" : "text-slate-500"}>{c.label}</span>
          </div>
        ))}
      </div>

      {(d.reasons.length > 0 || d.warnings.length > 0) && (
        <div className="mt-3 space-y-1 border-t border-edge pt-2">
          {d.reasons.map((r, i) => (
            <div key={`r${i}`} className="flex gap-1.5 text-xs text-emerald-300/90">
              <span className="shrink-0">＋</span>
              <span>{r}</span>
            </div>
          ))}
          {d.warnings.map((w, i) => (
            <div key={`w${i}`} className="flex gap-1.5 text-xs text-amber-300/90">
              <span className="shrink-0">！</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {(d.suggestedStopPrice != null || d.entryHint) && (
        <div className="mt-2 space-y-1 border-t border-edge pt-2 text-xs">
          {d.suggestedStopPrice != null && (
            <div className="text-slate-400">
              建议初始止损 ≈{" "}
              <span className="tabular text-down">{fmt(d.suggestedStopPrice, 3)}</span>
              <span className="text-slate-600">
                （-{fmt((d.suggestedStopPct ?? 0) * 100, 1)}%，1.8×日ATR）
              </span>
            </div>
          )}
          {d.entryHint && <div className="text-sky-300/90">时机：{d.entryHint}</div>}
        </div>
      )}
    </div>
  );
}
