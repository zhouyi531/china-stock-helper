import { useMemo, useState } from "react";
import { useLiveData } from "./hooks/useLiveData";
import { useAiStream } from "./hooks/useAiStream";
import { RegimeBar } from "./components/RegimeBar";
import { AddStock } from "./components/AddStock";
import { WatchlistTable } from "./components/WatchlistTable";
import { StockDetailDrawer } from "./components/StockDetailDrawer";
import { removeStock } from "./api/rest";
import { cls } from "./lib/format";

const STATUS_DOT: Record<string, string> = {
  open: "bg-emerald-500",
  connecting: "bg-amber-500",
  closed: "bg-red-500",
};

export default function App() {
  const { snapshot, status } = useLiveData();
  const ai = useAiStream();
  const [selected, setSelected] = useState<string | null>(null);

  const stocks = snapshot?.stocks ?? [];
  const clock = snapshot?.clock;

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
        </div>
        <div className="ml-auto">
          <AddStock onAdded={(s) => onSelect(s)} />
        </div>
      </header>

      <div className="mb-4">
        <RegimeBar regime={snapshot?.regime ?? null} />
      </div>

      {!snapshot && status !== "closed" ? (
        <div className="grid place-items-center py-24 text-slate-500">加载中…</div>
      ) : (
        <WatchlistTable
          stocks={stocks}
          selected={selected}
          onSelect={onSelect}
          onAi={onAi}
          onRemove={onRemove}
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
