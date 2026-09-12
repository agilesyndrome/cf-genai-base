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

test("feature catalog normalizes package metadata and rolls up health severity", async () => {
  const healthchecks = [
    { id: "auth:oauth", feature: "auth", component: "oauth", display_name: "OAuth", state: "green" },
    { id: "auth:session", feature: "auth", component: "session", display_name: "Sessions", state: "yellow" },
    { id: "llm:models", feature: "llm", component: "models", display_name: "Models", state: "red" },
  ];
  const breakers = [
    { id: "auth:rollup", feature: "auth", name: "rollup", display_name: "Auth feature", state: "on", allow_self_healing: 1 },
    { id: "llm:models", feature: "llm", name: "models", display_name: "LLM models", state: "tripped", allow_self_healing: 1 },
  ];
  const db = {
    prepare(sql) {
      const statement = { args: [], bind(...args) { this.args = args; return this; }, async all() {
        if (sql.includes("core_healthchecks")) return { results: healthchecks };
        if (sql.includes("core_circuit_breakers ORDER")) return { results: breakers };
        if (sql.includes("core_circuit_breaker_healthchecks")) return { results: [] };
        if (sql.includes("core_circuit_breaker_dependencies")) return { results: [] };
        return { results: [] };
      }, async first() {
        if (sql.includes("core_circuit_breakers WHERE id")) return breakers.find((item) => item.id === this.args[0]) || null;
        return null;
      } };
      return statement;
    }
  };
  const { listFeatureCatalog } = await import("../src/core.js");
  const catalog = await listFeatureCatalog({ DB: db }, [{ name: "auth", displayName: "Authentication", packageName: "@example/auth", version: "2.0.0" }, { name: "llm", displayName: "Language models", packageName: "@example/llm", version: "3.0.0" }]);
  assert.deepEqual(catalog.map((item) => [item.feature, item.health]), [["auth", "yellow"], ["base", "yellow"], ["llm", "red"]]);
  assert.equal(catalog[0].package_name, "@example/auth");
  assert.equal(catalog[0].circuit_breaker.state, "on");
  assert.equal(catalog[2].circuit_breaker, null);
});

test("admin feature API exposes installed runtime modules", async () => {
  const db = {
    prepare(sql) {
      const statement = { args: [], bind(...args) { this.args = args; return this; }, async run() { return {}; }, async all() {
        if (sql.includes("core_healthchecks")) return { results: [{ id: "auth:oauth", feature: "auth", component: "oauth", display_name: "OAuth", state: "green" }] };
        return { results: [] };
      }, async first() { return null; } };
      return statement;
    }
  };
  const worker = createWorker({ features: [{ name: "auth", packageName: "auth-package", version: "2.0.0" }], fetch: async () => new Response("site") });
  const request = new Request("https://example.test/api/admin/features", { headers: { Authorization: "Basic " + btoa("admin:secret") } });
  const response = await worker.fetch(request, { ADMIN_TOKEN: "secret", DB: db }, ctx);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.features.find((item) => item.feature === "auth").version, "2.0.0");
  assert.equal(payload.features.find((item) => item.feature === "auth").health, "green");
});

test("admin feature page renders the feature catalog", async () => {
  const db = {
    prepare(sql) {
      const statement = { args: [], bind(...args) { this.args = args; return this; }, async run() { return {}; }, async all() {
        if (sql.includes("core_healthchecks")) return { results: [] };
        return { results: [] };
      }, async first() { return null; } };
      return statement;
    }
  };
  const worker = createWorker({ features: [{ name: "llm", displayName: "Language models", packageName: "llm-package", version: "3.0.0" }], fetch: async () => new Response("site") });
  const request = new Request("https://example.test/admin/features", { headers: { Authorization: "Basic " + btoa("admin:secret") } });
  const response = await worker.fetch(request, { ADMIN_TOKEN: "secret", DB: db }, ctx);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Installed features/);
  assert.match(html, /llm-package/);
});
