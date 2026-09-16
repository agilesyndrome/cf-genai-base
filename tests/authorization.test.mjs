import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../src/index.js";
import { DEFAULT_TENANT_ID, createImpersonationToken, ensureUser, normalizeScopes, verifyImpersonationToken } from "../src/auth/index.js";
import { requestDataContext } from "../src/data/index.js";
import fs from "node:fs/promises";

const ctx = { waitUntil() {} };

test("tenant migration seeds the default tenant and migrates existing users", async () => {
  const migration = await fs.readFile(new URL("../migrations/0004_tenants.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_tenants/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_subscriptions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_tenant_subscriptions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS auth_user_tenants/);
  assert.match(migration, /'easley-family', 'Easley Family'/);
  assert.match(migration, /SELECT id, 'easley-family' FROM auth_users/);
});

test("new authorization users are attached to the default tenant", async () => {
  const statements = [];
  const user = { id: "user-1", provider: "oauth", subject: "subject-1", email: "person@example.test", display_name: "Person", is_admin: 0 };
  const db = {
    prepare(sql) {
      const statement = {
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("SELECT * FROM auth_users WHERE provider")) return null;
          if (sql.includes("SELECT * FROM auth_users WHERE id")) return user;
          return null;
        },
        async run() { statements.push({ sql, args: this.args }); return {}; },
      };
      return statement;
    },
    async batch(items) { statements.push(...items.map((item) => ({ sql: item.sql, args: item.args }))); },
  };
  // The D1 wrapper passes the SQL only to the underlying statement; expose it for this test double.
  const originalPrepare = db.prepare;
  db.prepare = (sql) => Object.assign(originalPrepare.call(db, sql), { sql });
  const result = await ensureUser({ DB: db }, { sub: "subject-1", email: user.email, name: user.display_name });
  assert.equal(result.id, user.id);
  assert.deepEqual(statements.slice(1).map((item) => item.args), [[DEFAULT_TENANT_ID, "Easley Family"], [statements[0].args[0], DEFAULT_TENANT_ID]]);
});

test("base leaves public routes public and protects admin routes by default", async () => {
  const worker = createWorker({ fetch: async () => new Response("ok") });
  assert.equal((await worker.fetch(new Request("https://example.test/"), {}, ctx)).status, 200);
  const response = await worker.fetch(new Request("https://example.test/api/admin/anything"), {}, ctx);
  assert.equal(response.status, 401);
  assert.match(response.headers.get("WWW-Authenticate"), /Basic/);
});

test("admin mutations require a same-origin Origin header", async () => {
  const worker = createWorker({ fetch: async () => new Response("ok") });
  const env = { ADMIN_TOKEN: "secret" };
  const auth = { Authorization: "Basic " + btoa("admin:secret") };
  assert.equal((await worker.fetch(new Request("https://example.test/api/admin/delete", { method: "POST", headers: auth }), env, ctx)).status, 403);
  assert.equal((await worker.fetch(new Request("https://example.test/api/admin/delete", { method: "POST", headers: { ...auth, Origin: "https://evil.test" } }), env, ctx)).status, 403);
  assert.equal((await worker.fetch(new Request("https://example.test/api/admin/delete", { method: "POST", headers: { ...auth, Origin: "https://example.test" } }), env, ctx)).status, 200);
});

test("feature routes are composed before the site handler", async () => {
  const worker = createWorker({
    features: [{ name: "example", routes: [{ path: "/plugin", handle: () => new Response("feature") }] }],
    fetch: async () => new Response("site"),
  });
  assert.equal(await (await worker.fetch(new Request("https://example.test/plugin"), {}, ctx)).text(), "feature");
  assert.equal(await (await worker.fetch(new Request("https://example.test/other"), {}, ctx)).text(), "site");
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
  const { listFeatureCatalog } = await import("../src/core/index.js");
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

test("admin feature routes remain API-first", async () => {
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
  assert.equal(await response.text(), "site");
});

test("active tenant rejects an invalid tenant id instead of falling back", async () => {
  const db = { prepare(sql) { const statement = { bind() { return this; }, async all() { return { results: sql.includes("auth_tenants") ? [{ id: DEFAULT_TENANT_ID, name: "Easley Family" }] : [] }; } }; return statement; } };
  const context = await requestDataContext({ DB: db }, { state: { authUser: { id: "user-1", is_admin: false } }, request: new Request("https://example.test/api/tenant", { headers: { "X-Tenant-ID": "not-a-tenant" } }) });
  assert.equal(context.tenantId, null);
  assert.equal(context.invalidTenant, true);
});

test("impersonation tokens require a secret and verify their target", async () => {
  await assert.rejects(() => createImpersonationToken({}, "admin-1", "user-2"), /AUTH_SESSION_SECRET/);
  const env = { AUTH_SESSION_SECRET: "a-secret-at-least-32-bytes-long-123" };
  const token = await createImpersonationToken(env, "admin-1", "user-2");
  assert.deepEqual((await verifyImpersonationToken(token, env)).targetUserId, "user-2");
  assert.equal(await verifyImpersonationToken(`${token}tampered`, env), null);
});
