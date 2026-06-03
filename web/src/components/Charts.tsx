import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { KlineResponse } from "../types";

const CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: "#0b1119" },
    textColor: "#7d8da0",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: "#1a2430" },
    horzLines: { color: "#1a2430" },
  },
  rightPriceScale: { borderColor: "#243140" },
  timeScale: { borderColor: "#243140" },
  crosshair: { mode: 0 as const },
};

function DailyChart({ data }: { data: KlineResponse }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || data.daily.length === 0) return;
    const chart = createChart(ref.current, {
      ...CHART_OPTS,
      width: ref.current.clientWidth,
      height: 260,
    });
    chartRef.current = chart;

    const candle = chart.addCandlestickSeries({
      upColor: "#ef4444",
      downColor: "#22c55e",
      borderUpColor: "#ef4444",
      borderDownColor: "#22c55e",
      wickUpColor: "#ef4444",
      wickDownColor: "#22c55e",
    });
    candle.setData(
      data.daily.map((b) => ({
        time: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      }))
    );

    const addMa = (key: "ma5" | "ma10" | "ma20", color: string) => {
      const series = chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false });
      series.setData(
        data.daily
          .map((b, i) => ({ time: b.date, value: data.ma[i]?.[key] }))
          .filter((p) => p.value != null) as { time: string; value: number }[]
      );
    };
    addMa("ma5", "#eab308");
    addMa("ma10", "#38bdf8");
    addMa("ma20", "#c084fc");

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-[11px]">
        <span className="text-slate-400">日K (前复权)</span>
        <span className="text-yellow-500">MA5</span>
        <span className="text-sky-400">MA10</span>
        <span className="text-purple-400">MA20</span>
      </div>
      <div ref={ref} className="w-full" />
    </div>
  );
}

function MinuteChart({ data }: { data: KlineResponse }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || data.minute.length === 0) return;
    const chart = createChart(ref.current, {
      ...CHART_OPTS,
      width: ref.current.clientWidth,
      height: 160,
      timeScale: { ...CHART_OPTS.timeScale, timeVisible: true, secondsVisible: false },
    });

    const baseDate = data.daily[data.daily.length - 1]?.date ?? new Date().toISOString().slice(0, 10);
    const [y, m, d] = baseDate.split("-").map(Number);
    const toTime = (hhmm: string): UTCTimestamp => {
      const hh = parseInt(hhmm.slice(0, 2), 10);
      const mm = parseInt(hhmm.slice(2, 4), 10);
      return (Date.UTC(y, m - 1, d, hh, mm) / 1000) as UTCTimestamp;
    };

    const price = chart.addLineSeries({ color: "#e2e8f0", lineWidth: 1, priceLineVisible: false });
    const vwap = chart.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false });

    price.setData(data.minute.map((p) => ({ time: toTime(p.time), value: p.price })));
    vwap.setData(
      data.minute
        .map((p) => ({
          time: toTime(p.time),
          value: p.cumVolume > 0 ? p.cumAmount / (p.cumVolume * 100) : p.price,
        }))
    );

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth });
    });
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data]);

  return (
    <div>
      <div className="mb-1 flex items-center gap-3 text-[11px]">
        <span className="text-slate-400">分时</span>
        <span className="text-slate-200">价格</span>
        <span className="text-amber-500">VWAP/均价</span>
      </div>
      <div ref={ref} className="w-full" />
    </div>
  );
}

export function Charts({ data }: { data: KlineResponse | null }) {
  if (!data) {
    return <div className="py-10 text-center text-sm text-slate-600">K线加载中…</div>;
  }
  if (data.daily.length === 0 && data.minute.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-600">暂无K线数据</div>;
  }
  return (
    <div className="space-y-4">
      <DailyChart data={data} />
      <MinuteChart data={data} />
    </div>
  );
}
