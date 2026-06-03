import type { StockSnapshot } from "../types";
import { cls, fmt, fmtPct, upDownClass } from "../lib/format";
import { EXIT_BADGE, EXIT_LABEL, TREND_BADGE, TREND_LABEL, isExitWarning } from "../lib/exit";

interface Props {
  stocks: StockSnapshot[];
  selected: string | null;
  onSelect: (symbol: string) => void;
  onAi: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

const TH = "px-3 py-2 text-xs font-medium text-slate-500 text-right whitespace-nowrap";
const TD = "px-3 py-2 text-sm text-right tabular whitespace-nowrap";

export function WatchlistTable({ stocks, selected, onSelect, onAi, onRemove }: Props) {
  if (stocks.length === 0) {
    return (
      <div className="grid place-items-center rounded-lg border border-dashed border-edge bg-panel py-20 text-center">
        <div>
          <p className="text-slate-300">还没有自选股</p>
          <p className="mt-1 text-sm text-slate-500">
            在上方输入股票代码（如 600000、sz000001、300750）添加到自选
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-edge bg-panel">
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="border-b border-edge">
            <th className={cls(TH, "text-left")}>名称 / 代码</th>
            <th className={TH}>现价</th>
            <th className={TH}>涨跌幅</th>
            <th className={TH}>VWAP偏离</th>
            <th className={TH}>分钟动量</th>
            <th className={TH}>量比</th>
            <th className={TH}>换手%</th>
            <th className={TH}>距涨停</th>
            <th className={TH}>盘口失衡</th>
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
                <td className="px-3 py-2 text-left">
                  <div className="flex items-center gap-2">
                    {warn && <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />}
                    <div>
                      <div className="text-sm font-medium text-slate-100">
                        {s.name || s.code}
                        {s.quote?.stale && (
                          <span className="ml-1 text-[10px] text-slate-600">延迟</span>
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
                    <td className={cls(TD, l.relativeVolume >= 1 ? "text-up" : "text-slate-400")}>
                      {fmt(l.relativeVolume, 2)}
                    </td>
                    <td className={TD}>{fmt(l.turnoverRate, 2)}</td>
                    <td className={cls(TD, l.distanceToLimitUp <= 3 ? "text-up" : "text-slate-400")}>
                      {fmtPct(l.distanceToLimitUp)}
                    </td>
                    <td className={cls(TD, upDownClass(l.orderBookImbalance))}>
                      {fmt(l.orderBookImbalance, 2)}
                    </td>
                    <td className={TD}>
                      {s.sector?.available ? (
                        <span title={s.sector.industry?.name}>
                          {fmt(s.sector.sectorScore, 0)}
                          <span className="text-[11px] text-slate-600">
                            {" "}
                            #{s.sector.industry?.rank}
                          </span>
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
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
                  <td className={cls(TD, "text-slate-600")} colSpan={9}>
                    {s.error || "数据加载中…"}
                  </td>
                )}

                <td className="px-3 py-2 text-center">
                  {s.position && s.exit ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <span
                        className={cls(
                          "rounded px-1.5 py-0.5 text-[11px] font-medium",
                          EXIT_BADGE[s.exit.kind]
                        )}
                      >
                        {EXIT_LABEL[s.exit.kind]}
                      </span>
                      <span className={cls("text-xs tabular", upDownClass(s.exit.pnlPct))}>
                        {fmtPct(s.exit.pnlPct)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600">未持仓</span>
                  )}
                </td>

                <td className="px-3 py-2">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onAi(s.symbol);
                      }}
                      className="rounded bg-violet-600/80 px-2 py-1 text-xs font-medium text-white transition hover:bg-violet-500"
                      title="AI 分析"
                    >
                      AI
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s.symbol);
                      }}
                      className="rounded border border-edge px-2 py-1 text-xs text-slate-300 transition hover:bg-panelraised"
                    >
                      详情
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`从自选中删除 ${s.name || s.code}?`)) onRemove(s.symbol);
                      }}
                      className="rounded px-1.5 py-1 text-xs text-slate-500 transition hover:text-down"
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
