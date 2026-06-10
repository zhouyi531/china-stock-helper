import type { ExitState } from "../types";
import { cls, fmt } from "../lib/format";
import { isExitWarning } from "../lib/exit";

export function ExitWarning({
  exit,
  onAck,
  busy,
}: {
  exit: ExitState | null;
  /** dismiss (true) or re-arm (false) the current warning */
  onAck?: (acknowledged: boolean) => void;
  busy?: boolean;
}) {
  if (!exit) return null;
  const k = exit.kind;
  if (k !== "take_profit_warn" && k !== "stop_loss_warn" && k !== "stop_loss_watch") return null;

  const warn = isExitWarning(k);
  const acked = warn && exit.acknowledged;

  const style = acked
    ? "border-edge bg-panelraised text-slate-400"
    : warn
      ? "border-alarm/70 bg-alarm/15 text-alarm"
      : "border-orange-500/40 bg-orange-500/10 text-orange-200";

  const title =
    k === "stop_loss_warn" ? "止损离场警告" : k === "take_profit_warn" ? "止盈离场警告" : "已跌破成本价";

  const keyPrice =
    k === "take_profit_warn"
      ? { label: "止盈目标价", value: exit.targetPrice }
      : { label: "止损线", value: exit.stopLossPrice };

  return (
    <div className={cls("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", style)}>
      <span className={cls("mt-0.5 text-base", warn && !acked && "animate-pulse")}>
        {k === "stop_loss_warn" ? "■" : "▲"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cls("font-semibold", acked && "font-medium")}>
            {title}
            {acked && "（已解除提醒）"}
          </span>
          {keyPrice.value != null && (
            <span className="rounded bg-black/20 px-1.5 py-0.5 text-[12px] font-semibold tabular">
              {keyPrice.label} {fmt(keyPrice.value, 3)}
            </span>
          )}
        </div>
        {exit.message && <div className="mt-0.5 text-[13px] opacity-90">{exit.message}</div>}
        {acked && (
          <div className="mt-0.5 text-[12px] text-slate-500">状态变化后将自动恢复提醒</div>
        )}
      </div>
      {warn && onAck && (
        <button
          onClick={() => onAck(!acked)}
          disabled={busy}
          className={cls(
            "shrink-0 rounded border px-2 py-1 text-xs transition disabled:opacity-50",
            acked
              ? "border-edge text-slate-400 hover:bg-panel hover:text-slate-200"
              : "border-alarm/60 text-alarm hover:bg-alarm/15"
          )}
        >
          {acked ? "恢复提醒" : "解除报警"}
        </button>
      )}
    </div>
  );
}
