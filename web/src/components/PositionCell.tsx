import { useEffect, useState } from "react";
import type { ExitDefaults, StockSnapshot } from "../types";
import { cls, fmtPct, upDownClass } from "../lib/format";
import { EXIT_BADGE, EXIT_LABEL } from "../lib/exit";
import { exitPosition, setPosition } from "../api/rest";

const FALLBACK: ExitDefaults = { trailPct: 0.0015, stopLossPct: 0.03 };
const toPctStr = (f: number) => String(+(f * 100).toFixed(4));
const inputCls =
  "rounded border border-edge bg-panelraised px-1.5 py-1 text-xs tabular outline-none focus:border-sky-500";

/** Inline entry/exit + stop-ratio controls for one watchlist row. */
export function PositionCell({
  stock,
  exitDefaults,
}: {
  stock: StockSnapshot;
  exitDefaults: ExitDefaults | null;
}) {
  const pos = stock.position;
  const exit = stock.exit;
  const price = stock.quote?.price ?? stock.layer1?.price ?? 0;
  const defaults = exitDefaults ?? FALLBACK;

  const [entry, setEntry] = useState("");
  const [trail, setTrail] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setEntry(pos ? String(pos.entryPrice) : price ? String(price) : "");
    setTrail(toPctStr(pos ? pos.trailPct : defaults.trailPct));
    setStopLoss(toPctStr(pos ? pos.stopLossPct : defaults.stopLossPct));
    setErr(null);
    // re-seed when the row's symbol or persisted position values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock.symbol, pos?.entryPrice, pos?.trailPct, pos?.stopLossPct]);

  const parsePcts = (): { tp: number; sl: number } | null => {
    const tp = parseFloat(trail);
    const sl = parseFloat(stopLoss);
    if (!Number.isFinite(tp) || tp <= 0 || tp >= 100) {
      setErr("止盈%需在 0~100");
      return null;
    }
    if (!Number.isFinite(sl) || sl <= 0 || sl >= 100) {
      setErr("止损%需在 0~100");
      return null;
    }
    return { tp, sl };
  };

  const enter = async () => {
    const ep = parseFloat(entry);
    if (!Number.isFinite(ep) || ep <= 0) {
      setErr("进场价无效");
      return;
    }
    const p = parsePcts();
    if (!p) return;
    setBusy(true);
    setErr(null);
    try {
      await setPosition(stock.symbol, ep, null, p.tp / 100, p.sl / 100);
    } catch (e: any) {
      setErr(e?.message || "失败");
    } finally {
      setBusy(false);
    }
  };

  const doExit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await exitPosition(stock.symbol);
    } catch (e: any) {
      setErr(e?.message || "失败");
    } finally {
      setBusy(false);
    }
  };

  // Save stop-ratio edits for a held position (entry unchanged -> peak kept).
  const saveRatios = async () => {
    if (!pos) return;
    const p = parsePcts();
    if (!p) return;
    if (p.tp / 100 === pos.trailPct && p.sl / 100 === pos.stopLossPct) return;
    setBusy(true);
    setErr(null);
    try {
      await setPosition(stock.symbol, pos.entryPrice, pos.shares, p.tp / 100, p.sl / 100);
    } catch (e: any) {
      setErr(e?.message || "失败");
    } finally {
      setBusy(false);
    }
  };

  const ratioRow = (onCommit?: () => void) => (
    <div className="flex items-center justify-end gap-1 text-[11px] text-slate-500">
      止盈
      <input
        value={trail}
        onChange={(e) => setTrail(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit?.()}
        className={cls(inputCls, "w-12 text-right")}
      />
      %<span className="w-1" />止损
      <input
        value={stopLoss}
        onChange={(e) => setStopLoss(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => e.key === "Enter" && onCommit?.()}
        className={cls(inputCls, "w-12 text-right")}
      />
      %
    </div>
  );

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex min-w-[220px] flex-col items-stretch gap-1"
    >
      {pos && exit ? (
        <>
          <div className="flex items-center justify-end gap-2">
            <span
              className={cls(
                "rounded px-1.5 py-0.5 text-[11px] font-medium",
                EXIT_BADGE[exit.kind]
              )}
            >
              {EXIT_LABEL[exit.kind]}
            </span>
            <span className={cls("text-xs tabular", upDownClass(exit.pnlPct))}>
              {fmtPct(exit.pnlPct)}
            </span>
            <button
              onClick={doExit}
              disabled={busy}
              className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              离场
            </button>
          </div>
          {ratioRow(saveRatios)}
        </>
      ) : (
        <>
          <div className="flex items-center justify-end gap-1">
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && enter()}
              placeholder="进场价"
              className={cls(inputCls, "w-20 text-right")}
            />
            <button
              onClick={enter}
              disabled={busy}
              className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
            >
              进场
            </button>
          </div>
          {ratioRow()}
        </>
      )}
      {err && <div className="text-right text-[10px] text-down">{err}</div>}
    </div>
  );
}
