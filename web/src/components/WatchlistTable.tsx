import type { ExitDefaults, StockSnapshot } from "../types";
import { cls, fmt, fmtMoneySigned, fmtPct, upDownClass } from "../lib/format";
import { TREND_BADGE, TREND_LABEL, isExitWarning } from "../lib/exit";
import { PositionCell } from "./PositionCell";

interface Props {
  stocks: StockSnapshot[];
  selected: string | null;
  exitDefaults: ExitDefaults | null;
  onSelect: (symbol: string) => void;
  onAi: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

const TH =
  "sticky top-0 z-10 bg-panel px-2 py-1.5 text-xs font-medium text-slate-500 text-right whitespace-nowrap border-b border-edge";
const TD = "px-2 py-1.5 text-sm text-right tabular whitespace-nowrap";

export function WatchlistTable({ stocks, selected, exitDefaults, onSelect, onAi, onRemove }: Props) {
  if (stocks.length === 0) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-edge bg-panel py-20 text-center">
        <div>
          <p className="text-slate-700">还没有自选股</p>
          <p className="mt-1 text-sm text-slate-500">
            在上方输入股票代码（如 600000、sz000001、300750）添加到自选
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-h-[calc(100vh-220px)] overflow-auto rounded-lg border border-edge bg-panel">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className={cls(TH, "text-left")}>名称 / 代码</th>
            <th className={TH}>现价</th>
            <th className={TH}>涨跌幅</th>
            <th className={TH}>VWAP偏离</th>
            <th className={TH}>分钟动量</th>
            <th className={TH}>量比</th>
            <th className={TH}>换手%</th>
            <th className={TH}>距涨停</th>
            <th className={TH}>盘口失衡</th>
            <th className={TH}>主力(DDE)</th>
            <th className={TH}>板块分</th>
            <th className={TH}>趋势分</th>
            <th className={cls(TH, "text-center")}>持仓 / 离场</th>
            <th className={cls(TH, "text-center")}>操作</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => {
            const l = s.layer1;
            const warn = s.exit && isExitWarning(s.exit.kind);
            return (
              <tr
                key={s.symbol}
                onClick={() => onSelect(s.symbol)}
                className={cls(
                  "cursor-pointer border-b border-edge/60 transition hover:bg-panelraised",
                  selected === s.symbol && "bg-panelraised",
                  warn && "bg-amber-500/5"
                )}
              >
                <td className="px-2 py-1.5 text-left">
                  <div className="flex items-center gap-1.5">
                    {warn && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />}
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        {s.name || s.code}
                        {s.quote?.stale && (
                          <span className="ml-1 text-[10px] text-slate-400">延迟</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">{s.symbol}</div>
                    </div>
                  </div>
                </td>

                {l ? (
                  <>
                    <td className={cls(TD, upDownClass(l.pctChange), "font-semibold")}>
                      {fmt(l.price, 2)}
                    </td>
                    <td className={cls(TD, upDownClass(l.pctChange))}>{fmtPct(l.pctChange)}</td>
                    <td className={cls(TD, upDownClass(l.priceVsVwap))}>{fmtPct(l.priceVsVwap)}</td>
                    <td className={cls(TD, upDownClass(l.intradayMomentum))}>
                      {fmtPct(l.intradayMomentum)}
                    </td>
                    <td className={cls(TD, l.relativeVolume >= 1 ? "text-up" : "text-slate-600")}>
                      {fmt(l.relativeVolume, 2)}
                    </td>
                    <td className={TD}>{fmt(l.turnoverRate, 2)}</td>
                    <td className={cls(TD, l.distanceToLimitUp <= 3 ? "text-up" : "text-slate-600")}>
                      {fmtPct(l.distanceToLimitUp)}
                    </td>
                    <td className={cls(TD, upDownClass(l.orderBookImbalance))}>
                      {fmt(l.orderBookImbalance, 2)}
                    </td>
                    <td
                      className={cls(
                        TD,
                        s.fundFlow?.available
                          ? upDownClass(s.fundFlow.mainNetInflow)
                          : "text-slate-400"
                      )}
                    >
                      {s.fundFlow?.available ? (
                        <span title="主力净流入净额 / 净占比">
                          {fmtMoneySigned(s.fundFlow.mainNetInflow)}
                          <span className="text-[11px] text-slate-400">
                            {" "}
                            {fmtPct(s.fundFlow.mainNetRatio)}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={TD}>
                      {s.sector?.available ? (
                        <span title={s.sector.industry?.name}>
                          {fmt(s.sector.sectorScore, 0)}
                          <span className="text-[11px] text-slate-400">
                            {" "}
                            #{s.sector.industry?.rank}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      <span
                        className={cls(
                          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
                          TREND_BADGE[l.trendTag]
                        )}
                      >
                        {fmt(l.trendScore, 0)} {TREND_LABEL[l.trendTag]}
                      </span>
                    </td>
                  </>
                ) : (
                  <td className={cls(TD, "text-slate-400")} colSpan={11}>
                    {s.error || "数据加载中…"}
                  </td>
                )}

                <td className="px-2 py-1.5">
                  <PositionCell stock={s} exitDefaults={exitDefaults} />
                </td>

                <td className="px-2 py-1.5">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAi(s.symbol);
                      }}
                      className="rounded bg-violet-600/80 px-1.5 py-0.5 text-xs font-medium text-white transition hover:bg-violet-500"
                      title="AI 分析"
                    >
                      AI
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s.symbol);
                      }}
                      className="rounded border border-edge px-1.5 py-0.5 text-xs text-slate-700 transition hover:bg-panelraised"
                    >
                      详情
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`从自选中删除 ${s.name || s.code}?`)) onRemove(s.symbol);
                      }}
                      className="rounded px-1 py-0.5 text-xs text-slate-500 transition hover:text-down"
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
