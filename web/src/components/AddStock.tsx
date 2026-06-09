import { useState } from "react";
import { addStock } from "../api/rest";

export function AddStock({ onAdded }: { onAdded: (symbol: string) => void }) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return;
    setLoading(true);
    setError(null);
    try {
      const r = await addStock(c);
      setCode("");
      onAdded(r.symbol);
    } catch (err: any) {
      setError(err?.message || "添加失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="输入股票代码，如 600000 / sz000001 / 300750"
        className="w-72 rounded-md border border-edge bg-panelraised px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-sky-500"
      />
      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
      >
        {loading ? "添加中…" : "添加自选"}
      </button>
      {error && <span className="text-sm text-down">{error}</span>}
    </form>
  );
}
