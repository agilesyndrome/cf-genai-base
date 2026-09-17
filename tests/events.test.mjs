import assert from "node:assert/strict";
import test from "node:test";
import { Event, auditLog, createEventHandler, emitEvent, eventLog, eventRooms } from "../src/core/events/index.js";

test("events preserve defaults, timestamps, JSON details, and rooms", () => {
  const event = Event(null, null, null, new Date("2025-01-02T03:04:05.000Z"), {
    audience: { userId: "u1", tenantId: "t1" },
    nested: { ok: true, omitted: undefined },
  });
  assert.match(event.id, /^[0-9a-f-]{36}$/i);
  assert.equal(event.who, "system");
  assert.equal(event.what, "event");
  assert.equal(event.where, "application");
  assert.equal(event.when, "2025-01-02T03:04:05.000Z");
  assert.deepEqual(event.details.nested, { ok: true });
  assert.deepEqual(eventRooms(event), ["user:u1", "tenant:t1"]);
  assert.deepEqual(eventRooms({ who: "user:fallback", details: {} }), ["user:fallback"]);
});

test("event handlers remain bound, dispatch together, and publish every room", async () => {
  const calls = [];
  const published = [];
  const feature = { name: "bound", async eventHandler(event, context) { calls.push([this.name, event.what, context.ctx]); } };
  const env = {
    EVENT_HUB: {
      idFromName: (room) => room,
      get: (room) => ({ fetch: async (_url, init) => { published.push([room, JSON.parse(init.body)]); return new Response(null); } }),
    },
  };
  const handler = createEventHandler([feature]);
  const event = Event("user:u1", "job.done", "job", undefined, { audience: { userId: "u1", tenantId: "t1" } });
  assert.equal(await handler(event, env, "ctx"), event);
  assert.deepEqual(calls, [["bound", "job.done", "ctx"]]);
  assert.deepEqual(published.map(([room]) => room), ["user:u1", "tenant:t1"]);
  assert.equal(published[0][1].id, event.id);
});

test("handler and publishing failures do not prevent unrelated dispatch", async () => {
  const calls = [];
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const handler = createEventHandler([
      { eventHandler: async () => { calls.push("failed"); throw new Error("handler failed"); } },
      { event_handler: async () => { calls.push("continued"); } },
    ]);
    const event = Event("user:u1", "job.failed", "job", undefined, { audience: { userId: "u1" } });
    await assert.rejects(() => handler(event, { EVENT_HUB: { idFromName: (room) => room, get: () => ({ fetch: async () => { throw new Error("publish failed"); } }) } }, null), /handler failed/);
    assert.deepEqual(calls, ["failed", "continued"]);
    assert.equal(warnings.some((entry) => String(entry[0]).includes("live.event.publish.failed")), true);
  } finally { console.warn = previousWarn; }
});

test("emitEvent delegates and event/audit logging redact sensitive values", async () => {
  const logs = [];
  const previousInfo = console.info;
  console.info = (...args) => logs.push(args);
  try {
    const event = Event("system", "safe", "test");
    const env = { eventHandler: async (received) => received };
    assert.equal(await emitEvent(env, event, null), event);
    eventLog("info", "logged", { token: "secret", nested: { cookie: "private", safe: "yes" } });
    auditLog({ operation: "read", resource: "thing", details: { authorization: "Bearer hidden" } });
    assert.equal(logs[0][1].token, "[REDACTED]");
    assert.equal(logs[0][1].nested.cookie, "[REDACTED]");
    assert.equal(logs[0][1].nested.safe, "yes");
    assert.equal(logs[1][1].authorization, "[REDACTED]");
  } finally { console.info = previousInfo; }
});
