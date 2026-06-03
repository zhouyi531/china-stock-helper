import { useEffect, useRef, useState } from "react";
import type { FullSnapshot, WsMessage } from "../types";
import { getSnapshot } from "../api/rest";

export type ConnStatus = "connecting" | "open" | "closed";

export interface LiveData {
  snapshot: FullSnapshot | null;
  status: ConnStatus;
}

/** Subscribes to /ws for realtime snapshots with auto-reconnect + REST seed. */
export function useLiveData(): LiveData {
  const [snapshot, setSnapshot] = useState<FullSnapshot | null>(null);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number>(0);

  useEffect(() => {
    let closed = false;

    // seed via REST so the UI paints before the first ws message
    getSnapshot()
      .then((s) => setSnapshot((cur) => cur ?? s))
      .catch(() => {});

    const connect = () => {
      if (closed) return;
      setStatus("connecting");
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        setStatus("open");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WsMessage;
          if (msg.type === "snapshot" || msg.type === "tick") setSnapshot(msg.data);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        if (closed) return;
        const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
        retryRef.current += 1;
        setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      wsRef.current?.close();
    };
  }, []);

  return { snapshot, status };
}
