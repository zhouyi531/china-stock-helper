import type { Regime, RegimeKind } from "../types";
import { cls, fmtAmount, fmtPct, upDownClass } from "../lib/format";

const KIND_STYLE: Record<RegimeKind, string> = {
  strong_trend: "bg-up/20 text-up border-up/40",
  theme: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  range: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  weak: "bg-down/15 text-down border-down/40",
  panic: "bg-down/25 text-down border-down/50",
  low_volume: "bg-slate-500/20 text-slate-300 border-slate-500/40",
};

export function RegimeBar({ regime }: { regime: Regime | null }) {
  if (!regime) {
    return (
      <div className="rounded-lg border border-edge bg-panel px-4 py-3 text-sm text-slate-500">
        市场状态加载中…
      </div>
    );
  }

  const b = regime.breadth;
  return (
    <div className="rounded-lg border border-edge bg-panel px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span
            className={cls(
              "rounded-md border px-2.5 py-1 text-sm font-semibold",
              KIND_STYLE[regime.kind]
            )}
            title={regime.reasons.join("\n")}
          >
            {regime.label}
          </span>
          <span className="text-xs text-slate-500">强弱分 {regime.score}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {regime.indices.map((i) => (
            <div key={i.symbol} className="flex items-baseline gap-1.5 text-sm tabular">
              <span className="text-slate-400">{i.name}</span>
              <span className={upDownClass(i.pctChange)}>{i.price.toFixed(2)}</span>
              <span className={cls("text-xs", upDownClass(i.pctChange))}>
                {fmtPct(i.pctChange)}
              </span>
              <span className={cls("text-[10px]", i.aboveVwap ? "text-up" : "text-down")}>
                {i.aboveVwap ? "▲VWAP" : "▼VWAP"}
              </span>
            </div>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-4 text-sm tabular">
          {b.available ? (
            <>
              <span>
                <span className="text-up">{b.advancers}</span>
                <span className="text-slate-500"> 涨 / </span>
                <span className="text-down">{b.decliners}</span>
                <span className="text-slate-500"> 跌</span>
              </span>
              <span className="text-slate-500">
                涨停 <span className="text-up">{b.limitUp}</span> / 跌停{" "}
                <span className="text-down">{b.limitDown}</span>
              </span>
              <span className="text-slate-400">两市 {fmtAmount(b.totalAmount)}</span>
            </>
          ) : (
            <span className="text-xs text-slate-600">涨跌家数/板块数据不可用（已降级）</span>
          )}
        </div>
      </div>
    </div>
  );
}
