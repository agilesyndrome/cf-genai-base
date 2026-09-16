import assert from "node:assert/strict";
import test from "node:test";
import { Event, createEventHandler, readJson, requestContext, requestIdentity, sameOrigin } from "../src/core/index.js";

test("Event and request context use the canonical identity contract", async () => {
  const received = [];
  const handler = createEventHandler([{ eventHandler: async (event) => received.push(event) }]);
  const state = { user: { authUser: { id: "u-1", provider: "clerk", subject: "sub-1", is_admin: true } } };
  const context = requestContext({ request: new Request("https://example.test/api"), env: { eventHandler: handler }, ctx: {}, state });
  assert.deepEqual(requestIdentity(state), { user: state.user, authUser: state.user.authUser, userId: "u-1", who: "user:u-1", isAuthenticated: true, isAdmin: true });
  await context.event("resource.changed", "domain", { resourceId: "s-1" });
  assert.equal(received[0].who, "user:u-1");
  assert.equal(received[0].what, "resource.changed");
  assert.equal(received[0].details.resourceId, "s-1");
});

test("same-origin and event contracts reject cross-site mutations", () => {
  const request = new Request("https://example.test/api", { method: "POST", headers: { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" } });
  assert.equal(sameOrigin(request), false);
  const event = Event("user:u-1", "test", "unit", "2026-09-16T00:00:00.000Z");
  assert.equal(event.when, "2026-09-16T00:00:00.000Z");
  assert.equal(event.details.value, undefined);
});

test("JSON body limits are enforced while streaming without Content-Length", async () => {
  const encoder = new TextEncoder();
  const body = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"value":"')); controller.enqueue(encoder.encode("x".repeat(128))); controller.enqueue(encoder.encode('"}')); controller.close(); } });
  const request = new Request("https://example.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" });
  await assert.rejects(() => readJson(request, 64), (error) => error.status === 413);
});
