import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../src/index.js";
import { normalizeScopes } from "../src/authorization.js";

const ctx = { waitUntil() {} };

test("base leaves public routes public and protects admin routes by default", async () => {
  const worker = createWorker({ fetch: async () => new Response("ok") });
  assert.equal((await worker.fetch(new Request("https://example.test/"), {}, ctx)).status, 200);
  const response = await worker.fetch(new Request("https://example.test/api/admin/anything"), {}, ctx);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("WWW-Authenticate"), /Basic/);
});

test("valid Basic credentials produce the platform admin principal", async () => {
  const worker = createWorker({ fetch: async (_request, _env, _ctx, _state) => Response.json({ ok: true }) });
  const request = new Request("https://example.test/api/admin/anything", { headers: { Authorization: `Basic ${btoa("admin:secret")}` } });
  const response = await worker.fetch(request, { ADMIN_TOKEN: "secret" }, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("scope manifests normalize only capability-shaped names", () => {
  assert.deepEqual(normalizeScopes([{ name: "recipe:author", label: "Recipe author" }, { name: "not valid" }]), [{ name: "recipe:author", label: "Recipe author", description: "", system: false }]);
});
