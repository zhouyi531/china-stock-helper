import type { ExitState } from "../types";
import { cls } from "../lib/format";

export function ExitWarning({ exit }: { exit: ExitState | null }) {
  if (!exit) return null;
  const k = exit.kind;
  if (k !== "take_profit_warn" && k !== "stop_loss_warn" && k !== "stop_loss_watch") return null;

  const style =
    k === "stop_loss_warn"
      ? "border-down/60 bg-down/15 text-down"
      : k === "take_profit_warn"
        ? "border-amber-500/60 bg-amber-500/15 text-amber-200"
        : "border-orange-500/40 bg-orange-500/10 text-orange-200";

  const title =
    k === "stop_loss_warn" ? "止损离场警告" : k === "take_profit_warn" ? "止盈离场警告" : "已跌破成本价";

  return (
    <div className={cls("flex items-start gap-2 rounded-md border px-3 py-2 text-sm", style)}>
      <span className="mt-0.5 text-base">{k === "stop_loss_warn" ? "■" : "▲"}</span>
      <div>
        <div className="font-semibold">{title}</div>
        {exit.message && <div className="mt-0.5 text-[13px] opacity-90">{exit.message}</div>}
      </div>
    </div>
  );
}
