import type { ExitStateKind, TrendTag } from "../types";

export const EXIT_LABEL: Record<ExitStateKind, string> = {
  none: "未持仓",
  watching: "持仓跟踪",
  take_profit_warn: "止盈离场警告",
  stop_loss_watch: "跌破成本",
  stop_loss_warn: "止损离场警告",
  exited: "已离场",
};

export const EXIT_BADGE: Record<ExitStateKind, string> = {
  none: "bg-slate-700/40 text-slate-400",
  watching: "bg-sky-500/15 text-sky-300",
  take_profit_warn: "bg-amber-500/20 text-amber-300",
  stop_loss_watch: "bg-orange-500/15 text-orange-300",
  stop_loss_warn: "bg-down/25 text-down",
  exited: "bg-slate-700/40 text-slate-400",
};

export function isExitWarning(kind: ExitStateKind): boolean {
  return kind === "take_profit_warn" || kind === "stop_loss_warn";
}

export const TREND_LABEL: Record<TrendTag, string> = {
  bull: "多",
  bear: "空",
  neutral: "中性",
};

export const TREND_BADGE: Record<TrendTag, string> = {
  bull: "bg-up/20 text-up",
  bear: "bg-down/20 text-down",
  neutral: "bg-slate-600/30 text-slate-300",
};
