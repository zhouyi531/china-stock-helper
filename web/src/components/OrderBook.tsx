import type { Quote } from "../types";
import { cls, fmt } from "../lib/format";

function Row({
  label,
  price,
  volume,
  max,
  side,
}: {
  label: string;
  price: number;
  volume: number;
  max: number;
  side: "ask" | "bid";
}) {
  const pct = max > 0 ? (volume / max) * 100 : 0;
  const barColor = side === "ask" ? "bg-down/15" : "bg-up/15";
  const textColor = side === "ask" ? "text-down" : "text-up";
  return (
    <div className="relative flex items-center justify-between px-2 py-1 text-sm tabular">
      <div
        className={cls("absolute inset-y-0 right-0", barColor)}
        style={{ width: `${pct}%` }}
      />
      <span className="relative z-10 text-slate-500">{label}</span>
      <span className={cls("relative z-10", textColor)}>{price > 0 ? fmt(price, 3) : "—"}</span>
      <span className="relative z-10 w-16 text-right text-slate-400">{volume || "—"}</span>
    </div>
  );
}

export function OrderBook({ quote }: { quote: Quote }) {
  const max = Math.max(
    1,
    ...quote.bids.map((b) => b.volume),
    ...quote.asks.map((a) => a.volume)
  );
  const asks = [...quote.asks].slice(0, 5);
  const bids = [...quote.bids].slice(0, 5);

  return (
    <div className="rounded-lg border border-edge bg-panel">
      <div className="border-b border-edge px-2 py-1.5 text-xs font-medium text-slate-500">
        五档盘口
      </div>
      <div className="divide-y divide-edge/40">
        {asks
          .map((a, i) => ({ a, i }))
          .reverse()
          .map(({ a, i }) => (
            <Row key={`a${i}`} label={`卖${i + 1}`} price={a.price} volume={a.volume} max={max} side="ask" />
          ))}
        <div className="px-2 py-1 text-center text-xs text-slate-600">— 委托盘口 (手) —</div>
        {bids.map((b, i) => (
          <Row key={`b${i}`} label={`买${i + 1}`} price={b.price} volume={b.volume} max={max} side="bid" />
        ))}
      </div>
    </div>
  );
}
