import { DurableObject } from "cloudflare:workers";

export class EventHub extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/publish") {
      if (request.headers.get("X-CF-GenAI-Event") !== "1") return new Response("Not found", { status: 404 });
      const event = await request.json().catch(() => null);
      if (!event?.id || !event?.what) return Response.json({ error: "Invalid event" }, { status: 400 });
      const message = JSON.stringify({ type: "event", event });
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send(message); } catch { socket.close(1011, "Event delivery failed"); }
      }
      return Response.json({ ok: true });
    }
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket upgrade required", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, message) {
    if (message === "ping") socket.send(JSON.stringify({ type: "pong" }));
  }

  webSocketClose() {}
  webSocketError() {}
}
