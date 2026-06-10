import { useEffect, useState } from "react";
import type { StockSnapshot } from "../types";
import { cls, fmt, fmtPct, upDownClass } from "../lib/format";
import { EXIT_BADGE, EXIT_LABEL } from "../lib/exit";
import { ackAlert, exitPosition, setExitConfig, setPosition } from "../api/rest";
import { ExitWarning } from "./ExitWarning";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={cls("text-sm tabular", color)}>{value}</div>
    </div>
  );
}

/** fraction -> percent string without float noise, e.g. 0.0015 -> "0.15" */
function pctStr(fraction: number): string {
  return String(Number((fraction * 100).toFixed(4)));
}

/** percent string -> fraction, e.g. "0.15" -> 0.0015; null when invalid */
function parsePct(s: string): number | null {
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Number((n / 100).toFixed(6));
}

export function PositionPanel({ stock }: { stock: StockSnapshot }) {
  const pos = stock.position;
  const exit = stock.exit;
  const price = stock.quote?.price ?? stock.layer1?.price ?? 0;

  const [entry, setEntry] = useState("");
  const [shares, setShares] = useState("");
  const [trail, setTrail] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setEntry(pos ? String(pos.entryPrice) : price ? String(price) : "");
    setShares(pos?.shares ? String(pos.shares) : "");
    setErr(null);
  }, [stock.symbol, pos?.entryPrice, pos?.shares]);

  useEffect(() => {
    if (exit) {
      setTrail(pctStr(exit.trailPct));
      setStopLoss(pctStr(exit.stopLossPct));
    }
  }, [stock.symbol, exit?.trailPct, exit?.stopLossPct]);

  const run = async (fn: () => Promise<void>, fallbackMsg: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e: any) {
      setErr(e?.message || fallbackMsg);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const ep = parseFloat(entry);
    if (!Number.isFinite(ep) || ep <= 0) {
      setErr("请输入有效的进场价");
      return;
    }
    await run(
      () => setPosition(stock.symbol, ep, shares ? parseFloat(shares) : null),
      "设置失败"
    );
  };

  const doExit = () => run(() => exitPosition(stock.symbol), "操作失败");

  const saveConfig = async () => {
    const t = parsePct(trail);
    const s = parsePct(stopLoss);
    if (t == null || t > 0.2) {
      setErr("止盈回撤无效（0 ~ 20%）");
      return;
    }
    if (s == null || s > 0.5) {
      setErr("止损比例无效（0 ~ 50%）");
      return;
    }
    await run(() => setExitConfig(stock.symbol, t, s), "保存指标失败");
  };

  const onAck = (acknowledged: boolean) =>
    run(() => ackAlert(stock.symbol, acknowledged), "操作失败");

  const pnlMoney =
    pos && pos.shares ? (price - pos.entryPrice) * pos.shares * 100 : null; // shares in 手

  const inputCls =
    "rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500";

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">持仓 / 离场跟踪</h3>
        {pos && exit && (
          <span className={cls("rounded px-2 py-0.5 text-xs font-medium", EXIT_BADGE[exit.kind])}>
            {EXIT_LABEL[exit.kind]}
          </span>
        )}
      </div>

      {pos && exit ? (
        <div className="space-y-3">
          <ExitWarning exit={exit} onAck={onAck} busy={busy} />

          <div className="grid grid-cols-3 gap-3">
            <Stat label="进场价" value={fmt(pos.entryPrice, 3)} />
            <Stat label="现价" value={fmt(price, 3)} color={upDownClass(exit.pnlPct)} />
            <Stat label="浮动盈亏" value={fmtPct(exit.pnlPct)} color={upDownClass(exit.pnlPct)} />
            <Stat label="记录最高 peak" value={fmt(exit.peak, 3)} />
            <Stat
              label={`止盈目标 (回撤${pctStr(exit.trailPct)}%${exit.trailMode === "atr" ? "·ATR自适应" : "·固定"})`}
              value={exit.targetPrice != null ? fmt(exit.targetPrice, 3) : "—"}
              color="text-amber-300"
            />
            <Stat
              label={`止损线 (-${pctStr(exit.stopLossPct)}%)`}
              value={fmt(exit.stopLossPrice, 3)}
              color="text-down"
            />
          </div>

          {exit.trailMode === "atr" && (
            <p className="text-[11px] leading-relaxed text-slate-600">
              当前为 ATR 自适应止盈：回撤阈值 ≈ 0.9×日ATR（限 0.8%~3.5%），浮盈越大自动收得越紧
              （+3%→0.85×，+6%→0.7×，+10%→0.55×）。下方手动保存后将固定为该值。
            </p>
          )}

          {pnlMoney != null && (
            <div className="text-xs text-slate-500">
              估算盈亏：
              <span className={cls("tabular", upDownClass(pnlMoney))}>
                {pnlMoney > 0 ? "+" : ""}
                {pnlMoney.toFixed(0)} 元
              </span>
              <span className="ml-1">({pos.shares} 手)</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
            <label className="text-xs text-slate-500">止盈回撤%</label>
            <input
              value={trail}
              onChange={(e) => setTrail(e.target.value)}
              className={cls(inputCls, "w-20")}
              placeholder="如 2"
            />
            <label className="text-xs text-slate-500">止损%</label>
            <input
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className={cls(inputCls, "w-20")}
              placeholder="3"
            />
            <button
              onClick={saveConfig}
              disabled={busy}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-slate-200 transition hover:bg-panelraised disabled:opacity-50"
            >
              固定为该值
            </button>
            {(pos.trailPct != null || pos.stopLossPct != null) && (
              <button
                onClick={() => run(() => setExitConfig(stock.symbol, null, null), "重置失败")}
                disabled={busy}
                className="rounded-md border border-edge px-3 py-1.5 text-sm text-slate-400 transition hover:bg-panelraised disabled:opacity-50"
                title="清除本股覆盖，恢复 ATR 自适应止盈与全局止损"
              >
                恢复自适应
              </button>
            )}
            <span className="text-[11px] text-slate-600">
              仅对本股生效{pos.trailPct == null && pos.stopLossPct == null ? "（当前为自适应）" : "（已固定）"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
            <label className="text-xs text-slate-500">进场价</label>
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className={cls(inputCls, "w-24")}
              placeholder="进场价"
            />
            <label className="text-xs text-slate-500">数量(手)</label>
            <input
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className={cls(inputCls, "w-20")}
              placeholder="选填"
            />
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-slate-200 transition hover:bg-panelraised disabled:opacity-50"
            >
              保存
            </button>
            <button
              onClick={doExit}
              disabled={busy}
              className="ml-auto rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              已离场
            </button>
          </div>
          {err && <div className="text-xs text-down">{err}</div>}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            设定进场价后开始计算离场条件：跟踪止盈默认 ATR 自适应（约0.9×日ATR，随浮盈收紧），止损默认
            -3%；开始跟踪后可按个股固定参数。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-500">进场价</label>
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className={cls(inputCls, "w-24")}
              placeholder="如 9.85"
            />
            <label className="text-xs text-slate-500">数量(手, 选填)</label>
            <input
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className={cls(inputCls, "w-24")}
              placeholder="如 10"
            />
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md bg-sky-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
            >
              开始跟踪离场
            </button>
          </div>
          {err && <div className="text-xs text-down">{err}</div>}
        </div>
      )}
    </div>
  );
}
