import { useEffect, useState } from "react";
import type { ExitDefaults, StockSnapshot } from "../types";
import { cls, fmt, fmtPct, upDownClass } from "../lib/format";
import { EXIT_BADGE, EXIT_LABEL } from "../lib/exit";
import { exitPosition, setPosition } from "../api/rest";
import { ExitWarning } from "./ExitWarning";

const FALLBACK_DEFAULTS: ExitDefaults = { trailPct: 0.0015, stopLossPct: 0.03 };

/** fraction (0.0015) -> percent input string ("0.15") */
const toPctStr = (f: number) => String(+(f * 100).toFixed(4));

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={cls("text-sm tabular", color)}>{value}</div>
    </div>
  );
}

export function PositionPanel({
  stock,
  exitDefaults,
}: {
  stock: StockSnapshot;
  exitDefaults: ExitDefaults | null;
}) {
  const pos = stock.position;
  const exit = stock.exit;
  const price = stock.quote?.price ?? stock.layer1?.price ?? 0;
  const defaults = exitDefaults ?? FALLBACK_DEFAULTS;

  const [entry, setEntry] = useState("");
  const [shares, setShares] = useState("");
  const [trail, setTrail] = useState(""); // percent, e.g. "0.15"
  const [stopLoss, setStopLoss] = useState(""); // percent, e.g. "3"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setEntry(pos ? String(pos.entryPrice) : price ? String(price) : "");
    setShares(pos?.shares ? String(pos.shares) : "");
    setTrail(toPctStr(pos ? pos.trailPct : defaults.trailPct));
    setStopLoss(toPctStr(pos ? pos.stopLossPct : defaults.stopLossPct));
    setErr(null);
  }, [stock.symbol, pos?.entryPrice, pos?.trailPct, pos?.stopLossPct]);

  const save = async () => {
    const ep = parseFloat(entry);
    if (!Number.isFinite(ep) || ep <= 0) {
      setErr("请输入有效的进场价");
      return;
    }
    const tp = parseFloat(trail);
    const sl = parseFloat(stopLoss);
    if (!Number.isFinite(tp) || tp <= 0 || tp >= 100) {
      setErr("回撤止盈%需在 0~100 之间");
      return;
    }
    if (!Number.isFinite(sl) || sl <= 0 || sl >= 100) {
      setErr("止损%需在 0~100 之间");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await setPosition(stock.symbol, ep, shares ? parseFloat(shares) : null, tp / 100, sl / 100);
    } catch (e: any) {
      setErr(e?.message || "设置失败");
    } finally {
      setBusy(false);
    }
  };

  const doExit = async () => {
    setBusy(true);
    try {
      await exitPosition(stock.symbol);
    } catch (e: any) {
      setErr(e?.message || "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const pnlMoney =
    pos && pos.shares ? (price - pos.entryPrice) * pos.shares * 100 : null; // shares in 手

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">持仓 / 离场跟踪</h3>
        {pos && exit && (
          <span className={cls("rounded px-2 py-0.5 text-xs font-medium", EXIT_BADGE[exit.kind])}>
            {EXIT_LABEL[exit.kind]}
          </span>
        )}
      </div>

      {pos && exit ? (
        <div className="space-y-3">
          <ExitWarning exit={exit} />

          <div className="grid grid-cols-3 gap-3">
            <Stat label="进场价" value={fmt(pos.entryPrice, 3)} />
            <Stat label="现价" value={fmt(price, 3)} color={upDownClass(exit.pnlPct)} />
            <Stat label="浮动盈亏" value={fmtPct(exit.pnlPct)} color={upDownClass(exit.pnlPct)} />
            <Stat label="记录最高 peak" value={fmt(exit.peak, 3)} />
            <Stat
              label={`止盈目标 (回撤${toPctStr(pos.trailPct)}%)`}
              value={exit.targetPrice != null ? fmt(exit.targetPrice, 3) : "—"}
              color="text-amber-700"
            />
            <Stat
              label={`止损线 (-${toPctStr(pos.stopLossPct)}%)`}
              value={fmt(exit.stopLossPrice, 3)}
              color="text-down"
            />
          </div>

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
            <label className="text-xs text-slate-500">进场价</label>
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className="w-20 rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              placeholder="进场价"
            />
            <label className="text-xs text-slate-500">回撤止盈%</label>
            <input
              value={trail}
              onChange={(e) => setTrail(e.target.value)}
              className="w-16 rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              placeholder="0.15"
            />
            <label className="text-xs text-slate-500">止损%</label>
            <input
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="w-16 rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              placeholder="3"
            />
            <button
              onClick={save}
              disabled={busy}
              className="rounded-md border border-edge px-3 py-1.5 text-sm text-slate-800 transition hover:bg-panelraised disabled:opacity-50"
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
            设定进场价后开始计算离场条件（跟踪止盈回撤 {trail || toPctStr(defaults.trailPct)}%，止损 -
            {stopLoss || toPctStr(defaults.stopLossPct)}%，可自定义）。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-500">进场价</label>
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              className="w-20 rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              placeholder="如 9.85"
            />
            <label className="text-xs text-slate-500">数量(手, 选填)</label>
            <input
              value={shares}
              onChange={(e) => setShares(e.target.value)}
              className="w-16 rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              placeholder="如 10"
            />
            <label className="text-xs text-slate-500">回撤止盈%</label>
            <input
              value={trail}
              onChange={(e) => setTrail(e.target.value)}
              className="w-16 rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              placeholder="0.15"
            />
            <label className="text-xs text-slate-500">止损%</label>
            <input
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              className="w-16 rounded-md border border-edge bg-panelraised px-2 py-1.5 text-sm outline-none focus:border-sky-500"
              placeholder="3"
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
