import "./cloudflare-workers-loader.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { EventHub } = await import("../src/core/events/hub.js");

class TestResponse {
  static json(value, init = {}) { return new TestResponse(JSON.stringify(value), { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } }); }
  constructor(body = null, init = {}) { this.body = body; this.status = init.status || 200; this.webSocket = init.webSocket; }
  async json() { return JSON.parse(this.body); }
}

function hub(sockets = []) {
  const accepted = [];
  const instance = new EventHub({ getWebSockets: () => sockets, acceptWebSocket: (socket) => accepted.push(socket) }, {});
  return { instance, accepted };
}

test("EventHub rejects malformed JSON and missing event fields", async () => {
  const originalResponse = globalThis.Response;
  globalThis.Response = TestResponse;
  try {
    const { instance } = hub();
    const invalidJson = await instance.fetch(new Request("https://hub.test/publish", { method: "POST", headers: { "X-CF-GenAI-Event": "1" }, body: "{" }));
    assert.equal(invalidJson.status, 400);
    const missing = await instance.fetch(new Request("https://hub.test/publish", { method: "POST", headers: { "X-CF-GenAI-Event": "1", "Content-Type": "application/json" }, body: JSON.stringify({ id: "id" }) }));
    assert.equal(missing.status, 400);
    assert.deepEqual(await missing.json(), { error: "Invalid event" });
    const unauthenticated = await instance.fetch(new Request("https://hub.test/publish", { method: "POST", body: "{}" }));
    assert.equal(unauthenticated.status, 404);
  } finally { globalThis.Response = originalResponse; }
});

test("EventHub publishes valid events and isolates socket delivery failures", async () => {
  const originalResponse = globalThis.Response;
  globalThis.Response = TestResponse;
  const sent = [];
  const closed = [];
  const sockets = [
    { send: (message) => sent.push(JSON.parse(message)), close() {} },
    { send: () => { throw new Error("closed"); }, close: (...args) => closed.push(args) },
  ];
  try {
    const { instance } = hub(sockets);
    const event = { id: "event-1", who: "system", what: "job.done", where: "job", when: new Date().toISOString(), details: {} };
    const response = await instance.fetch(new Request("https://hub.test/publish", { method: "POST", headers: { "X-CF-GenAI-Event": "1", "Content-Type": "application/json" }, body: JSON.stringify(event) }));
    assert.equal(response.status, 200);
    assert.deepEqual(sent, [{ type: "event", event }]);
    assert.deepEqual(closed, [[1011, "Event delivery failed"]]);
  } finally { globalThis.Response = originalResponse; }
});

test("EventHub enforces upgrade grammar and handles WebSocket lifecycle callbacks", async () => {
  const originalResponse = globalThis.Response;
  const originalPair = globalThis.WebSocketPair;
  globalThis.Response = TestResponse;
  const client = { side: "client" };
  const server = { side: "server" };
  globalThis.WebSocketPair = class { constructor() { return { 0: client, 1: server }; } };
  try {
    const { instance, accepted } = hub();
    assert.equal((await instance.fetch(new Request("https://hub.test/connect", { method: "PUT" }))).status, 426);
    assert.equal((await instance.fetch(new Request("https://hub.test/connect"))).status, 426);
    const upgraded = await instance.fetch(new Request("https://hub.test/connect", { headers: { Upgrade: "websocket" } }));
    assert.equal(upgraded.status, 101);
    assert.equal(upgraded.webSocket, client);
    assert.deepEqual(accepted, [server]);
    const messages = [];
    const socket = { send: (message) => messages.push(JSON.parse(message)) };
    instance.webSocketMessage(socket, "ping");
    instance.webSocketMessage(socket, "ignored");
    instance.webSocketMessage(socket, new ArrayBuffer(0));
    assert.deepEqual(messages, [{ type: "pong" }]);
    assert.equal(instance.webSocketClose(socket, 1000, "done", true), undefined);
    assert.equal(instance.webSocketError(socket, new Error("ignored")), undefined);
  } finally { globalThis.Response = originalResponse; globalThis.WebSocketPair = originalPair; }
});
