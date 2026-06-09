import { useEffect, useState } from "react";
import type { ExitDefaults, KlineResponse, StockSnapshot } from "../types";
import type { AiStreamState } from "../hooks/useAiStream";
import { getKline } from "../api/rest";
import { cls, fmt, fmtMoneySigned, fmtPct, upDownClass } from "../lib/format";
import { Charts } from "./Charts";
import { OrderBook } from "./OrderBook";
import { PositionPanel } from "./PositionPanel";
import { AiPanel } from "./AiPanel";

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="rounded-md border border-edge/60 bg-panelraised px-2.5 py-1.5">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={cls("text-sm tabular", color)}>{value}</div>
    </div>
  );
}

export function StockDetailDrawer({
  stock,
  ai,
  exitDefaults,
  onClose,
}: {
  stock: StockSnapshot;
  ai: AiStreamState;
  exitDefaults: ExitDefaults | null;
  onClose: () => void;
}) {
  const [kline, setKline] = useState<KlineResponse | null>(null);
  const l = stock.layer1;
  const q = stock.quote;

  useEffect(() => {
    let active = true;
    setKline(null);
    const load = () =>
      getKline(stock.symbol)
        .then((k) => active && setKline(k))
        .catch(() => active && setKline({ symbol: stock.symbol, daily: [], minute: [], ma: [] }));
    load();
    const id = setInterval(load, 30000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [stock.symbol]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-50 flex h-full w-full max-w-2xl flex-col overflow-y-auto border-l border-edge bg-white shadow-2xl">
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-edge bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-baseline gap-3">
            <h2 className="text-lg font-semibold text-slate-900">{stock.name || stock.code}</h2>
            <span className="rounded bg-panelraised px-1.5 py-0.5 text-[11px] uppercase text-slate-600">
              {stock.symbol}
            </span>
            {q?.stale && <span className="text-[11px] text-slate-400">数据延迟/已收盘</span>}
          </div>
          {l && (
            <div className="flex items-baseline gap-2">
              <span className={cls("text-xl font-semibold tabular", upDownClass(l.pctChange))}>
                {fmt(l.price, 2)}
              </span>
              <span className={cls("text-sm tabular", upDownClass(l.pctChange))}>
                {fmtPct(l.pctChange)}
              </span>
            </div>
          )}
          <button
            onClick={onClose}
            className="ml-2 rounded p-1 text-slate-500 transition hover:bg-panelraised hover:text-slate-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-4">
          {/* full layer-1 metrics */}
          {l && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              <Metric label="VWAP/均价" value={fmt(l.vwap, 3)} />
              <Metric label="价对VWAP" value={fmtPct(l.priceVsVwap)} color={upDownClass(l.priceVsVwap)} />
              <Metric label="跳空" value={fmtPct(l.gapPct)} color={upDownClass(l.gapPct)} />
              <Metric label="分钟动量" value={fmtPct(l.intradayMomentum)} color={upDownClass(l.intradayMomentum)} />
              <Metric label="MA5" value={fmt(l.ma5, 2)} />
              <Metric label="MA10" value={fmt(l.ma10, 2)} />
              <Metric label="MA20" value={fmt(l.ma20, 2)} />
              <Metric
                label="所属行业"
                value={stock.sector?.industry?.name ?? "—"}
              />
              <Metric
                label="板块涨幅"
                value={stock.sector?.industry ? fmtPct(stock.sector.industry.pctChange) : "—"}
                color={stock.sector?.industry ? upDownClass(stock.sector.industry.pctChange) : undefined}
              />
              <Metric
                label="主力净额(DDE)"
                value={stock.fundFlow?.available ? fmtMoneySigned(stock.fundFlow.mainNetInflow) : "—"}
                color={stock.fundFlow?.available ? upDownClass(stock.fundFlow.mainNetInflow) : undefined}
              />
              <Metric label="量比" value={fmt(l.relativeVolume, 2)} color={l.relativeVolume >= 1 ? "text-up" : undefined} />
              <Metric label="换手率" value={fmtPct(l.turnoverRate)} />
              <Metric label="振幅" value={fmtPct(l.amplitude)} />
              <Metric label="波动率" value={fmtPct(l.volatility)} />
              <Metric label="盘口失衡" value={fmt(l.orderBookImbalance, 2)} color={upDownClass(l.orderBookImbalance)} />
              <Metric label="距涨停" value={fmtPct(l.distanceToLimitUp)} color="text-up" />
              <Metric label="距跌停" value={fmtPct(l.distanceToLimitDown)} color="text-down" />
              <Metric label="买卖价差" value={fmtPct(l.bidAskSpread)} />
              <Metric label="趋势分" value={`${fmt(l.trendScore, 0)} / 100`} />
            </div>
          )}

          {/* sector */}
          {stock.sector?.available && stock.sector.industry ? (
            <div className="rounded-lg border border-edge bg-panel px-3 py-2 text-sm">
              <span className="text-slate-500">所属行业：</span>
              <span className="text-slate-800">{stock.sector.industry.name}</span>
              <span className={cls("ml-2", upDownClass(stock.sector.industry.pctChange))}>
                {fmtPct(stock.sector.industry.pctChange)}
              </span>
              <span className="ml-2 text-slate-500">
                排名 {stock.sector.industry.rank}/{stock.sector.industry.total} · sector_score{" "}
                {fmt(stock.sector.sectorScore, 0)}
              </span>
              {stock.sector.concepts.length > 0 && (
                <div className="mt-1 text-xs text-slate-500">
                  概念：{stock.sector.concepts.map((c) => c.name).join("、")}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-edge bg-panel px-3 py-2 text-xs text-slate-400">
              板块/题材数据不可用（数据源降级）
            </div>
          )}

          {/* charts */}
          <div className="rounded-lg border border-edge bg-panel p-3">
            <Charts data={kline} />
          </div>

          {q && <OrderBook quote={q} />}

          <PositionPanel stock={stock} exitDefaults={exitDefaults} />

          <AiPanel symbol={stock.symbol} hasPosition={!!stock.position} ai={ai} />
        </div>
      </div>
    </div>
  );
}
