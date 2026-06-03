import { useCallback, useRef, useState } from "react";
import type { AiMode } from "../types";

export type AiStatus = "idle" | "streaming" | "done" | "error";

export interface AiStreamState {
  status: AiStatus;
  text: string;
  mode: AiMode | null;
  model: string | null;
  error: string | null;
  run: (symbol: string) => Promise<void>;
  reset: () => void;
  setText: (t: string, mode: AiMode | null) => void;
}

export function useAiStream(): AiStreamState {
  const [status, setStatus] = useState<AiStatus>("idle");
  const [text, setTextState] = useState("");
  const [mode, setMode] = useState<AiMode | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
    setTextState("");
    setMode(null);
    setError(null);
  }, []);

  const setText = useCallback((t: string, m: AiMode | null) => {
    setTextState(t);
    setMode(m);
    setStatus("done");
    setError(null);
  }, []);

  const run = useCallback(async (symbol: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("streaming");
    setTextState("");
    setError(null);

    try {
      const res = await fetch(`/api/ai/${symbol}`, {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => ({}));
        throw new Error((b as any)?.error || `AI 请求失败 (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let evt = "message";
      let acc = "";

      const dispatch = (event: string, dataStr: string) => {
        let data: any = null;
        try {
          data = JSON.parse(dataStr);
        } catch {
          return;
        }
        if (event === "meta") {
          setMode(data.mode ?? null);
          setModel(data.model ?? null);
        } else if (event === "message") {
          if (typeof data.delta === "string") {
            acc += data.delta;
            setTextState(acc);
          }
        } else if (event === "done") {
          setStatus("done");
        } else if (event === "error") {
          setError(data.error || "AI 调用失败");
          setStatus("error");
        }
      };

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).replace(/\r$/, "");
          buffer = buffer.slice(idx + 1);
          if (line === "") {
            evt = "message";
            continue;
          }
          if (line.startsWith("event:")) evt = line.slice(6).trim();
          else if (line.startsWith("data:")) dispatch(evt, line.slice(5).trim());
        }
      }
      setStatus((s) => (s === "error" ? s : "done"));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message || "AI 调用失败");
      setStatus("error");
    }
  }, []);

  return { status, text, mode, model, error, run, reset, setText };
}
