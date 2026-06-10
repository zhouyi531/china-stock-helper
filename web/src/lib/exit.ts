import type { DecisionAction, ExitState, ExitStateKind, TrendTag } from "../types";

export const EXIT_LABEL: Record<ExitStateKind, string> = {
  none: "未持仓",
  watching: "持仓跟踪",
  take_profit_warn: "止盈离场警告",
  stop_loss_watch: "跌破成本",
  stop_loss_warn: "止损离场警告",
  exited: "已离场",
};

export const EXIT_BADGE: Record<ExitStateKind, string> = {
  none: "bg-slate-300/40 text-slate-600",
  watching: "bg-sky-500/15 text-sky-700",
  take_profit_warn: "bg-amber-500/20 text-amber-700",
  stop_loss_watch: "bg-orange-500/15 text-orange-700",
  stop_loss_warn: "bg-down/25 text-down",
  exited: "bg-slate-300/40 text-slate-600",
};

export function isExitWarning(kind: ExitStateKind): boolean {
  return kind === "take_profit_warn" || kind === "stop_loss_warn";
}

/** A warning that is live and not yet dismissed by the user. */
export function isActiveAlert(exit: ExitState | null | undefined): boolean {
  return !!exit && isExitWarning(exit.kind) && !exit.acknowledged;
}

export const TREND_LABEL: Record<TrendTag, string> = {
  bull: "多",
  bear: "空",
  neutral: "中性",
};

export const TREND_BADGE: Record<TrendTag, string> = {
  bull: "bg-up/20 text-up",
  bear: "bg-down/20 text-down",
  neutral: "bg-slate-400/30 text-slate-700",
};

export const DECISION_LABEL: Record<DecisionAction, string> = {
  strong_buy: "强买信号",
  buy: "可买入",
  watch: "观望",
  hold: "持有",
  reduce: "减仓",
  exit: "离场",
  avoid: "回避",
};

export const DECISION_BADGE: Record<DecisionAction, string> = {
  strong_buy: "bg-up/25 text-up font-bold",
  buy: "bg-up/15 text-up",
  watch: "bg-slate-600/30 text-slate-300",
  hold: "bg-sky-500/15 text-sky-300",
  reduce: "bg-amber-500/20 text-amber-300",
  exit: "bg-down/25 text-down font-bold",
  avoid: "bg-down/15 text-down",
};
