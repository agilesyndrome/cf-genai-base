import { DurableObject } from "cloudflare:workers";
import type { AppEvent, EventDetails } from "./index.js";

export interface EventHubEnvironment {}

interface EventHubMessage {
  type: "event";
  event: AppEvent;
}

export class EventHub extends DurableObject<EventHubEnvironment> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/publish") {
      if (request.headers.get("X-CF-GenAI-Event") !== "1") return new Response("Not found", { status: 404 });
      const value: unknown = await request.json().catch(() => null);
      if (!isAppEvent(value)) return Response.json({ error: "Invalid event" }, { status: 400 });
      const message: EventHubMessage = { type: "event", event: value };
      const serialized = JSON.stringify(message);
      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(serialized);
        } catch {
          socket.close(1011, "Event delivery failed");
        }
      }
      return Response.json({ ok: true });
    }
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message === "ping") socket.send(JSON.stringify({ type: "pong" }));
  }

  webSocketClose(_socket: WebSocket, _code: number, _reason: string, _wasClean: boolean): void {}

  webSocketError(_socket: WebSocket, _error: unknown): void {}
}

function isAppEvent(value: unknown): value is AppEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const id: unknown = Reflect.get(value, "id");
  const what: unknown = Reflect.get(value, "what");
  return typeof id === "string"
    && id.length > 0
    && typeof what === "string"
    && what.length > 0
    && typeof Reflect.get(value, "who") === "string"
    && typeof Reflect.get(value, "where") === "string"
    && typeof Reflect.get(value, "when") === "string"
    && isEventDetails(Reflect.get(value, "details"));
}

function isEventDetails(value: unknown): value is EventDetails {
  return value !== null && typeof value === "object" && !Array.isArray(value) && isJsonValue(value);
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === "object" && Object.values(value).every(isJsonValue);
}
