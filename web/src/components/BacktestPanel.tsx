import { useState } from "react";
import type { BacktestResult, BacktestStrategy } from "../types";
import { getBacktest } from "../api/rest";
import { cls, fmt, fmtPct, upDownClass } from "../lib/format";

const REASON_LABEL: Record<string, string> = {
  trail: "跟踪止盈",
  hard_stop: "止损",
  signal: "信号离场",
  eod: "期末平仓",
};

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-md border border-edge/60 bg-panelraised px-2 py-1.5">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={cls("text-sm tabular", color ?? "text-slate-200")}>{value}</div>
    </div>
  );
}

/**
 * Parameter-validation backtest: runs the chosen entry strategy over ~250
 * daily bars and sweeps the trailing stop so you can SEE which leash width
 * actually makes money on this specific stock.
 */
export function BacktestPanel({ symbol }: { symbol: string }) {
  const [strategy, setStrategy] = useState<BacktestStrategy>("ma");
  const [trail, setTrail] = useState("4");
  const [stop, setStop] = useState("3");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<BacktestResult | null>(null);
  const [showTrades, setShowTrades] = useState(false);

  const run = async () => {
    const t = parseFloat(trail) / 100;
    const s = parseFloat(stop) / 100;
    if (!Number.isFinite(t) || t <= 0 || !Number.isFinite(s) || s <= 0) {
      setErr("参数无效");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setRes(await getBacktest(symbol, strategy, t, s));
    } catch (e: any) {
      setErr(e?.message || "回测失败");
    } finally {
      setBusy(false);
    }
  };

  const m = res?.metrics;
  const inputCls =
    "w-16 rounded-md border border-edge bg-panelraised px-2 py-1 text-sm outline-none focus:border-sky-500";

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">参数回测验证</h3>
        <span className="text-[11px] text-slate-600">近一年日线 · 含0.2%摩擦成本 · 次日开盘成交</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={strategy}
          onChange={(e) => setStrategy(e.target.value as BacktestStrategy)}
          className="rounded-md border border-edge bg-panelraised px-2 py-1 text-sm text-slate-200 outline-none"
        >
          <option value="ma">均线多头启动</option>
          <option value="breakout">20日新高放量突破</option>
        </select>
        <label className="text-slate-500">止盈回撤%</label>
        <input value={trail} onChange={(e) => setTrail(e.target.value)} className={inputCls} />
        <label className="text-slate-500">止损%</label>
        <input value={stop} onChange={(e) => setStop(e.target.value)} className={inputCls} />
        <button
          onClick={run}
          disabled={busy}
          className="rounded-md bg-sky-600 px-3 py-1 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
        >
          {busy ? "回测中…" : "运行回测"}
        </button>
      </div>
      {err && <div className="mt-2 text-xs text-down">{err}</div>}

      {res && m && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <MetricCell label="交易次数" value={String(m.trades)} />
            <MetricCell label="胜率" value={m.winRate != null ? `${m.winRate}%` : "—"} />
            <MetricCell
              label="盈亏比"
              value={
                m.avgWinPct != null && m.avgLossPct != null && m.avgLossPct !== 0
                  ? fmt(Math.abs(m.avgWinPct / m.avgLossPct), 2)
                  : "—"
              }
            />
            <MetricCell
              label="策略收益"
              value={fmtPct(m.totalReturnPct)}
              color={upDownClass(m.totalReturnPct)}
            />
            <MetricCell
              label="买入持有"
              value={fmtPct(m.buyHoldReturnPct)}
              color={upDownClass(m.buyHoldReturnPct)}
            />
            <MetricCell label="最大回撤" value={`-${fmt(m.maxDrawdownPct, 1)}%`} color="text-down" />
            <MetricCell label="平均持有" value={m.avgHoldDays != null ? `${m.avgHoldDays}天` : "—"} />
            <MetricCell
              label="利润因子"
              value={m.profitFactor != null ? fmt(m.profitFactor, 2) : "—"}
              color={m.profitFactor != null && m.profitFactor >= 1.5 ? "text-up" : undefined}
            />
            <MetricCell label="平均盈利" value={m.avgWinPct != null ? `+${m.avgWinPct}%` : "—"} color="text-up" />
            <MetricCell label="平均亏损" value={m.avgLossPct != null ? `${m.avgLossPct}%` : "—"} color="text-down" />
          </div>

          {res.sweep && res.sweep.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-slate-500">
                止盈回撤参数扫描（同策略、同止损下不同“回撤宽度”的表现 → 找到适合本股的基准值）
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs tabular">
                  <thead>
                    <tr className="text-slate-500">
                      <td className="px-2 py-1">回撤</td>
                      {res.sweep.map((s) => (
                        <td
                          key={s.trailPct}
                          className={cls(
                            "px-2 py-1 text-right",
                            s.trailPct === res.trailPct && "text-sky-300"
                          )}
                        >
                          {(s.trailPct * 100).toFixed(1)}%
                        </td>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-edge/60">
                      <td className="px-2 py-1 text-slate-500">总收益</td>
                      {res.sweep.map((s) => (
                        <td
                          key={s.trailPct}
                          className={cls("px-2 py-1 text-right", upDownClass(s.metrics.totalReturnPct))}
                        >
                          {fmt(s.metrics.totalReturnPct, 1)}%
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-edge/60">
                      <td className="px-2 py-1 text-slate-500">胜率</td>
                      {res.sweep.map((s) => (
                        <td key={s.trailPct} className="px-2 py-1 text-right text-slate-300">
                          {s.metrics.winRate != null ? `${fmt(s.metrics.winRate, 0)}%` : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-t border-edge/60">
                      <td className="px-2 py-1 text-slate-500">次数</td>
                      {res.sweep.map((s) => (
                        <td key={s.trailPct} className="px-2 py-1 text-right text-slate-400">
                          {s.metrics.trades}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {res.trades.length > 0 && (
            <div>
              <button
                onClick={() => setShowTrades((v) => !v)}
                className="text-xs text-sky-400 hover:text-sky-300"
              >
                {showTrades ? "收起" : `查看最近 ${res.trades.length} 笔模拟交易 ↓`}
              </button>
              {showTrades && (
                <div className="mt-1 max-h-48 overflow-y-auto rounded border border-edge/60">
                  <table className="min-w-full text-xs tabular">
                    <thead className="sticky top-0 bg-panelraised text-slate-500">
                      <tr>
                        <td className="px-2 py-1">进场</td>
                        <td className="px-2 py-1 text-right">价格</td>
                        <td className="px-2 py-1">离场</td>
                        <td className="px-2 py-1 text-right">价格</td>
                        <td className="px-2 py-1 text-right">盈亏</td>
                        <td className="px-2 py-1">原因</td>
                      </tr>
                    </thead>
                    <tbody>
                      {[...res.trades].reverse().map((t, i) => (
                        <tr key={i} className="border-t border-edge/40">
                          <td className="px-2 py-1 text-slate-400">{t.entryDate}</td>
                          <td className="px-2 py-1 text-right text-slate-300">{fmt(t.entryPrice, 2)}</td>
                          <td className="px-2 py-1 text-slate-400">{t.exitDate}</td>
                          <td className="px-2 py-1 text-right text-slate-300">{fmt(t.exitPrice, 2)}</td>
                          <td className={cls("px-2 py-1 text-right", upDownClass(t.pnlPct))}>
                            {fmtPct(t.pnlPct)}
                          </td>
                          <td className="px-2 py-1 text-slate-500">{REASON_LABEL[t.exitReason]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] leading-relaxed text-slate-600">
            回测基于日线粒度与保守成交假设（开盘跳空按开盘价、盘中触线按触发价成交），结果存在路径误差，仅用于
            比较参数相对优劣，不代表未来收益。
          </p>
        </div>
      )}
    </div>
  );
}
