import type { StockSnapshot } from "../types";
import { cls, fmt, fmtPct, fmtSigned, upDownClass } from "../lib/format";
import {
  DECISION_BADGE,
  DECISION_LABEL,
  EXIT_BADGE,
  EXIT_LABEL,
  TREND_BADGE,
  TREND_LABEL,
  isActiveAlert,
  isExitWarning,
} from "../lib/exit";

/** Columns the user can sort by. */
export type SortKey =
  | "price"
  | "pctChange"
  | "vwap"
  | "momentum"
  | "relVol"
  | "turnover"
  | "limitDist"
  | "orderImb"
  | "sector"
  | "trend"
  | "decision"
  | "pnl";

export type SortDir = "asc" | "desc";

/** Numeric accessor per sort key; null = missing (always sorted last). */
export const SORT_ACCESSORS: Record<SortKey, (s: StockSnapshot) => number | null> = {
  price: (s) => s.layer1?.price ?? null,
  pctChange: (s) => s.layer1?.pctChange ?? null,
  vwap: (s) => s.layer1?.priceVsVwap ?? null,
  momentum: (s) => s.layer1?.intradayMomentum ?? null,
  relVol: (s) => s.layer1?.relativeVolume ?? null,
  turnover: (s) => s.layer1?.turnoverRate ?? null,
  limitDist: (s) => s.layer1?.distanceToLimitUp ?? null,
  orderImb: (s) => s.layer1?.orderBookImbalance ?? null,
  sector: (s) => (s.sector?.available ? s.sector.sectorScore : null),
  trend: (s) => s.layer1?.trendScore ?? null,
  decision: (s) => s.decision?.score ?? null,
  pnl: (s) => s.exit?.pnlPct ?? null,
};

/** First click sorts in this direction (距涨停: smaller = closer = more interesting). */
export const SORT_FIRST_DIR: Partial<Record<SortKey, SortDir>> = {
  limitDist: "asc",
};

interface ColumnDef {
  key: SortKey | null;
  label: string;
  align?: "left" | "center";
}

const COLUMNS: ColumnDef[] = [
  { key: null, label: "名称 / 代码", align: "left" },
  { key: "price", label: "现价" },
  { key: "pctChange", label: "涨跌幅" },
  { key: "vwap", label: "VWAP偏离" },
  { key: "momentum", label: "分钟动量" },
  { key: "relVol", label: "量比" },
  { key: "turnover", label: "换手%" },
  { key: "limitDist", label: "距涨停" },
  { key: "orderImb", label: "盘口失衡" },
  { key: "sector", label: "板块分" },
  { key: "trend", label: "趋势分" },
  { key: "decision", label: "决策", align: "center" },
  { key: "pnl", label: "持仓 / 离场", align: "center" },
  { key: null, label: "操作", align: "center" },
];

interface Props {
  stocks: StockSnapshot[];
  selected: string | null;
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onSelect: (symbol: string) => void;
  onAi: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onAck: (symbol: string) => void;
  onTogglePin: (symbol: string, pinned: boolean) => void;
}

// sticky header: solid bg + inset shadow as the bottom edge (real borders
// don't stick with border-collapse tables)
const TH =
  "sticky top-0 z-10 bg-panel px-3 py-2 text-xs font-medium text-slate-500 text-right whitespace-nowrap shadow-[inset_0_-1px_0_0_#243140]";
const TD = "px-3 py-2 text-sm text-right tabular whitespace-nowrap";

export function WatchlistTable({
  stocks,
  selected,
  sortKey,
  sortDir,
  onSort,
  onSelect,
  onAi,
  onRemove,
  onAck,
  onTogglePin,
}: Props) {
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
    <div className="max-h-[calc(100vh-200px)] overflow-auto rounded-lg border border-edge bg-panel">
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const sortable = c.key != null;
              const isActive = sortable && sortKey === c.key;
              return (
                <th
                  key={c.label}
                  onClick={sortable ? () => onSort(c.key!) : undefined}
                  title={sortable ? "点击排序" : undefined}
                  className={cls(
                    TH,
                    c.align === "left" && "text-left",
                    c.align === "center" && "text-center",
                    sortable && "cursor-pointer select-none hover:text-slate-300",
                    isActive && "text-sky-300"
                  )}
                >
                  {c.label}
                  {isActive && (
                    <span className="ml-0.5 text-[10px]">{sortDir === "desc" ? "▼" : "▲"}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => {
            const l = s.layer1;
            const warn = s.exit && isExitWarning(s.exit.kind);
            const active = isActiveAlert(s.exit); // warning not yet dismissed -> loud styling
            const price = s.quote?.price ?? l?.price ?? null;
            const pnlMoney =
              s.position?.shares && price != null
                ? (price - s.position.entryPrice) * s.position.shares * 100 // shares in 手
                : null;
            return (
              <tr
                key={s.symbol}
                onClick={() => onSelect(s.symbol)}
                className={cls(
                  "cursor-pointer border-b border-edge/60 transition hover:bg-panelraised",
                  selected === s.symbol && "bg-panelraised",
                  active ? "bg-alarm/10" : warn && "bg-amber-500/5"
                )}
              >
                <td className="px-3 py-2 text-left">
                  <div className="flex items-center gap-2">
                    {active && <span className="h-2 w-2 animate-pulse rounded-full bg-alarm" />}
                    <div>
                      <div
                        className={cls(
                          "flex items-center gap-1.5 text-sm",
                          active ? "font-bold text-alarm" : "font-medium text-slate-100"
                        )}
                      >
                        {s.pinned && (
                          <span
                            className="rounded border border-sky-500/50 px-1 text-[10px] font-normal leading-4 text-sky-400"
                            title="已置顶"
                          >
                            顶
                          </span>
                        )}
                        {s.name || s.code}
                        {s.quote?.stale && (
                          <span className="text-[10px] font-normal text-slate-600">延迟</span>
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
                        title={`日内分 ${fmt(l.intradayScore, 0)} / 日线分 ${l.dailyScore != null ? fmt(l.dailyScore, 0) : "—"}`}
                      >
                        {fmt(l.trendScore, 0)} {TREND_LABEL[l.trendTag]}
                      </span>
                    </td>
                    <td className={cls(TD, "text-center")}>
                      {s.decision ? (
                        <span
                          className={cls(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
                            DECISION_BADGE[s.decision.action]
                          )}
                          title={[
                            `机会分 ${fmt(s.decision.score, 0)}/100，置信度 ${fmt(s.decision.confidence, 0)}`,
                            ...s.decision.reasons.map((r) => `+ ${r}`),
                            ...s.decision.warnings.map((w) => `! ${w}`),
                          ].join("\n")}
                        >
                          {DECISION_LABEL[s.decision.action]}
                          <span className="text-[10px] opacity-80">{fmt(s.decision.score, 0)}</span>
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </>
                ) : (
                  <td className={cls(TD, "text-slate-600")} colSpan={11}>
                    {s.error || "数据加载中…"}
                  </td>
                )}

                <td className="px-3 py-2 text-center">
                  {s.position && s.exit ? (
                    <div className="flex flex-col items-center gap-0.5">
                      <span
                        className={cls(
                          "rounded px-1.5 py-0.5 text-[11px]",
                          active
                            ? "bg-alarm/20 font-bold text-alarm"
                            : warn
                              ? "bg-slate-700/40 font-medium text-slate-400" // acknowledged
                              : cls("font-medium", EXIT_BADGE[s.exit.kind])
                        )}
                        title={warn && !active ? "已解除提醒，状态变化后会重新提醒" : undefined}
                      >
                        {EXIT_LABEL[s.exit.kind]}
                        {warn && !active && "·已解除"}
                      </span>
                      {s.exit.targetPrice != null && (
                        <span className="text-[11px] tabular text-amber-300/90">
                          止盈目标 {fmt(s.exit.targetPrice, 2)}
                        </span>
                      )}
                      {(s.exit.kind === "stop_loss_watch" || s.exit.kind === "stop_loss_warn") && (
                        <span className="text-[11px] tabular text-down">
                          止损线 {fmt(s.exit.stopLossPrice, 2)}
                        </span>
                      )}
                      <span className={cls("text-xs tabular", upDownClass(s.exit.pnlPct))}>
                        {fmtPct(s.exit.pnlPct)}
                        {pnlMoney != null && (
                          <span className="ml-1">
                            {fmtSigned(pnlMoney, 0)}元
                          </span>
                        )}
                      </span>
                      {active && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAck(s.symbol);
                          }}
                          className="rounded border border-alarm/50 px-1.5 py-0.5 text-[11px] text-alarm transition hover:bg-alarm/15"
                          title="解除本次报警（状态变化后会重新提醒）"
                        >
                          解除报警
                        </button>
                      )}
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
                        onTogglePin(s.symbol, !s.pinned);
                      }}
                      className={cls(
                        "rounded border px-1.5 py-1 text-xs transition",
                        s.pinned
                          ? "border-sky-500/50 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25"
                          : "border-edge text-slate-500 hover:text-slate-300"
                      )}
                      title={s.pinned ? "取消置顶" : "置顶"}
                    >
                      顶
                    </button>
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
