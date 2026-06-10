import { useMemo, useState } from "react";
import { useLiveData } from "./hooks/useLiveData";
import { useAiStream } from "./hooks/useAiStream";
import { useAlertSound, useSoundPrefs } from "./hooks/useAlertSound";
import { RegimeBar } from "./components/RegimeBar";
import { AddStock } from "./components/AddStock";
import {
  SORT_ACCESSORS,
  SORT_FIRST_DIR,
  WatchlistTable,
  type SortDir,
  type SortKey,
} from "./components/WatchlistTable";
import { StockDetailDrawer } from "./components/StockDetailDrawer";
import { ScannerPanel } from "./components/ScannerPanel";
import { ackAlert, removeStock, setPinned } from "./api/rest";
import { cls } from "./lib/format";
import { isActiveAlert } from "./lib/exit";

const STATUS_DOT: Record<string, string> = {
  open: "bg-emerald-500",
  connecting: "bg-amber-500",
  closed: "bg-red-500",
};

export default function App() {
  const { snapshot, status } = useLiveData();
  const ai = useAiStream();
  const [selected, setSelected] = useState<string | null>(null);
  const soundPrefs = useSoundPrefs();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rawStocks = snapshot?.stocks ?? [];
  const clock = snapshot?.clock;

  // row order: active alarms first, then pinned, then the rest;
  // within each group apply the user's column sort (or keep manual order)
  const stocks = useMemo(() => {
    const accessor = sortKey ? SORT_ACCESSORS[sortKey] : null;
    return rawStocks
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const ga = isActiveAlert(a.s.exit) ? 0 : a.s.pinned ? 1 : 2;
        const gb = isActiveAlert(b.s.exit) ? 0 : b.s.pinned ? 1 : 2;
        if (ga !== gb) return ga - gb;
        if (accessor) {
          const va = accessor(a.s);
          const vb = accessor(b.s);
          if (va != null || vb != null) {
            if (va == null) return 1; // missing values always sink
            if (vb == null) return -1;
            if (va !== vb) return sortDir === "desc" ? vb - va : va - vb;
          }
        }
        return a.i - b.i;
      })
      .map((x) => x.s);
  }, [rawStocks, sortKey, sortDir]);

  useAlertSound(stocks, soundPrefs);

  // click cycle per column: first dir -> opposite -> back to manual order
  const onSort = (key: SortKey) => {
    const firstDir = SORT_FIRST_DIR[key] ?? "desc";
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir(firstDir);
    } else if (sortDir === firstDir) {
      setSortDir(firstDir === "desc" ? "asc" : "desc");
    } else {
      setSortKey(null);
    }
  };

  const selectedStock = useMemo(
    () => stocks.find((s) => s.symbol === selected) ?? null,
    [stocks, selected]
  );

  const onSelect = (symbol: string) => {
    if (symbol !== selected) ai.reset();
    setSelected(symbol);
  };
  const onAi = (symbol: string) => {
    setSelected(symbol);
    ai.run(symbol);
  };
  const onRemove = async (symbol: string) => {
    await removeStock(symbol).catch(() => {});
    if (selected === symbol) setSelected(null);
  };
  const onAck = (symbol: string) => {
    ackAlert(symbol).catch(() => {});
  };
  const onTogglePin = (symbol: string, pinned: boolean) => {
    setPinned(symbol, pinned).catch(() => {});
  };

  return (
    <div className="mx-auto max-w-[1500px] p-4">
      <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-100">A股看盘助手</h1>
          {clock && (
            <span
              className={cls(
                "rounded-md px-2 py-1 text-xs font-medium",
                clock.open ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700/40 text-slate-400"
              )}
            >
              {clock.label}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={cls("h-2 w-2 rounded-full", STATUS_DOT[status])} />
            {status === "open" ? "实时" : status === "connecting" ? "连接中" : "已断开"}
          </span>
          <button
            onClick={soundPrefs.toggleTakeProfit}
            title={soundPrefs.takeProfit ? "关闭止盈警报音" : "开启止盈警报音"}
            className={cls(
              "rounded-md border px-2 py-1 text-xs transition",
              soundPrefs.takeProfit
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                : "border-edge text-slate-500 hover:text-slate-300"
            )}
          >
            止盈音 {soundPrefs.takeProfit ? "开" : "关"}
          </button>
          <button
            onClick={soundPrefs.toggleStopLoss}
            title={soundPrefs.stopLoss ? "关闭止损警报音" : "开启止损警报音"}
            className={cls(
              "rounded-md border px-2 py-1 text-xs transition",
              soundPrefs.stopLoss
                ? "border-alarm/40 bg-alarm/10 text-alarm hover:bg-alarm/20"
                : "border-edge text-slate-500 hover:text-slate-300"
            )}
          >
            止损音 {soundPrefs.stopLoss ? "开" : "关"}
          </button>
        </div>
        <div className="ml-auto">
          <AddStock onAdded={(s) => onSelect(s)} />
        </div>
      </header>

      <div className="mb-4">
        <RegimeBar regime={snapshot?.regime ?? null} />
      </div>

      <div className="mb-4">
        <ScannerPanel
          open={scannerOpen}
          onToggle={() => setScannerOpen((v) => !v)}
          onSelect={(s) => onSelect(s)}
        />
      </div>

      {!snapshot && status !== "closed" ? (
        <div className="grid place-items-center py-24 text-slate-500">加载中…</div>
      ) : (
        <WatchlistTable
          stocks={stocks}
          selected={selected}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          onSelect={onSelect}
          onAi={onAi}
          onRemove={onRemove}
          onAck={onAck}
          onTogglePin={onTogglePin}
        />
      )}

      <footer className="mt-6 text-center text-[11px] text-slate-600">
        数据来自腾讯/新浪/东方财富公开接口，可能延迟或有误。本工具仅供学习与个人辅助，不构成投资建议。
      </footer>

      {selectedStock && (
        <StockDetailDrawer stock={selectedStock} ai={ai} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
