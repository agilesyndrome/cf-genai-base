import assert from "node:assert/strict";
import test from "node:test";
import { requestContext, requestIdentity } from "../src/auth/identity/index.js";
import { Event, createEventHandler } from "../src/core/events/index.js";
import { normalizeFeatureManifest } from "../src/core/healthchecks/index.js";
import { readJson, readJsonClone, requireAdmin, requireUser, sameOrigin, secureJson, secureResponse, secureText } from "../src/core/security/index.js";

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

test("security JSON readers validate objects, preserve the original body, and report typed status errors", async () => {
  const request = new Request("https://example.test/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "ok" }),
  });
  assert.deepEqual(await readJson(request), { value: "ok" });
  assert.equal(request.bodyUsed, false);

  for (const body of ["null", "[]", "42", "not-json"]) {
    const invalid = new Request("https://example.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const result = await readJsonClone(invalid);
    assert.equal(result.value, undefined);
    assert.equal(result.error.status, 400);
  }

  const missing = new Request("https://example.test/api", { method: "POST", headers: { "Content-Type": "application/json" } });
  await assert.rejects(() => readJson(missing), (error) => error.status === 400 && error.message === "Request body required");
  const wrongType = new Request("https://example.test/api", { method: "POST", body: "{}" });
  await assert.rejects(() => readJson(wrongType), (error) => error.status === 415);
});

test("security JSON limits count UTF-8 bytes and cancel oversized cloned streams", async () => {
  const request = new Request("https://example.test/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: "é" }) });
  await assert.rejects(() => readJson(request, 10), (error) => error.status === 413);
  assert.equal(request.bodyUsed, false);
});

test("sameOrigin supports defaults, explicit origins, and fetch-site enforcement", () => {
  const same = (origin, site) => new Request("https://example.test/api", { method: "POST", headers: { Origin: origin, ...(site ? { "Sec-Fetch-Site": site } : {}) } });
  assert.equal(sameOrigin(same("https://example.test")), true);
  assert.equal(sameOrigin(same("https://trusted.example"), "https://trusted.example"), true);
  assert.equal(sameOrigin(same("https://trusted.example"), ["https://other.example", "https://trusted.example"]), true);
  assert.equal(sameOrigin(same("https://evil.example")), false);
  assert.equal(sameOrigin(same("https://example.test", "cross-site")), false);
  assert.equal(sameOrigin({ url: "not a URL", headers: new Headers({ Origin: "https://example.test" }) }), false);
  assert.equal(sameOrigin(new Request("https://example.test/api")), false);
});

test("secure responses preserve response data while applying security defaults", async () => {
  const response = secureResponse(new Response("body", { status: 201, statusText: "Created", headers: { "X-Test": "present" } }));
  assert.equal(response.status, 201);
  assert.equal(response.statusText, "Created");
  assert.equal(response.headers.get("X-Test"), "present");
  assert.equal(await response.text(), "body");
  assert.equal(secureJson({ ok: true }, 200, { "Cache-Control": "public" }).headers.get("Cache-Control"), "public");
  assert.equal(secureText("ok", 200, "private").headers.get("Content-Type"), "text/plain; charset=utf-8");
});

test("authorization helpers support canonical snake_case and camelCase identities", () => {
  assert.equal(requireUser(null)?.status, 401);
  assert.equal(requireUser({}), null);
  assert.equal(requireAdmin({ is_admin: true }), null);
  assert.equal(requireAdmin({ isAdmin: true }), null);
  assert.equal(requireAdmin({ is_admin: false })?.status, 403);
});

test("feature manifests accept only canonical v5 fields", () => {
  assert.deepEqual(normalizeFeatureManifest({ name: "llm", displayName: "LLM", packageName: "base", version: "5.0.3" }), { feature: "llm", display_name: "LLM", package_name: "base", version: "5.0.3" });
  assert.throws(() => normalizeFeatureManifest({ id: "llm", display_name: "LLM" }), /not supported/);
});
