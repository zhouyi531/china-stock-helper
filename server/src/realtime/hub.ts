import type { WebSocket } from "@fastify/websocket";
import type { WsMessage } from "../types.js";

/** Tracks open websocket clients and broadcasts JSON messages to them. */
class WsHub {
  private clients = new Set<WebSocket>();

  add(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    ws.on("error", () => this.clients.delete(ws));
  }

  send(ws: WebSocket, msg: WsMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      this.clients.delete(ws);
    }
  }

  broadcast(msg: WsMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.clients) {
      try {
        ws.send(payload);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  get size(): number {
    return this.clients.size;
  }
}

export const hub = new WsHub();
