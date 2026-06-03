import { useEffect, useState } from "react";
import type { AiAnalysisRecord, AiMode } from "../types";
import type { AiStreamState } from "../hooks/useAiStream";
import { getAiHistory } from "../api/rest";
import { cls } from "../lib/format";

const MODE_LABEL: Record<AiMode, string> = {
  entry: "开仓时机分析",
  exit: "离场时机分析",
};

export function AiPanel({
  symbol,
  hasPosition,
  ai,
}: {
  symbol: string;
  hasPosition: boolean;
  ai: AiStreamState;
}) {
  const [history, setHistory] = useState<AiAnalysisRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = () => {
    getAiHistory(symbol)
      .then(setHistory)
      .catch(() => setHistory([]));
  };

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // refresh history after a run completes
  useEffect(() => {
    if (ai.status === "done") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai.status]);

  const mode = ai.mode ?? (hasPosition ? "exit" : "entry");

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-200">AI 走势分析</h3>
        <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[11px] text-violet-300">
          {MODE_LABEL[mode]}
        </span>
        {ai.model && <span className="text-[11px] text-slate-600">{ai.model}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="rounded border border-edge px-2 py-1 text-xs text-slate-400 transition hover:bg-panelraised"
          >
            历史 {history.length > 0 && `(${history.length})`}
          </button>
          <button
            onClick={() => ai.run(symbol)}
            disabled={ai.status === "streaming"}
            className="rounded bg-violet-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
          >
            {ai.status === "streaming" ? "分析中…" : "运行 AI 分析"}
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="mb-2 max-h-40 space-y-1 overflow-y-auto rounded border border-edge/60 bg-panelraised p-2">
          {history.length === 0 ? (
            <p className="text-xs text-slate-600">暂无历史分析</p>
          ) : (
            history.map((h) => (
              <button
                key={h.id}
                onClick={() => {
                  ai.setText(h.content, h.mode);
                  setShowHistory(false);
                }}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-slate-400 transition hover:bg-panel"
              >
                <span className="text-slate-500">
                  {new Date(h.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </span>{" "}
                · {MODE_LABEL[h.mode]} · {h.content.slice(0, 40)}…
              </button>
            ))
          )}
        </div>
      )}

      <div
        className={cls(
          "min-h-[120px] whitespace-pre-wrap rounded border border-edge/60 bg-[#0b1119] p-3 text-[13px] leading-relaxed",
          ai.status === "error" ? "text-down" : "text-slate-200"
        )}
      >
        {ai.status === "error"
          ? ai.error
          : ai.text ||
            (ai.status === "streaming"
              ? "正在请求 AI…"
              : "点击「运行 AI 分析」，将该股票的关键指标、市场 regime、板块强度与持仓/离场状态发送给 AI 进行研判。")}
        {ai.status === "streaming" && <span className="ml-0.5 animate-pulse">▋</span>}
      </div>
      <p className="mt-1 text-[11px] text-slate-600">AI 输出为量化研判参考，非投资建议。</p>
    </div>
  );
}
