import assert from "node:assert/strict";
import test from "node:test";
import { createRepositories, defineRepository } from "../src/repository.js";
import { defineApp } from "../src/app.js";
import { AppDomain, createWorker, defineFeature, resolveFeatures } from "../src/index.js";
import { defineRoute, dispatchRoutes } from "../src/api/contracts.js";
import { createReadOnlyDataReader } from "../src/data/reader.js";
import { readOnlyD1 } from "../src/core/database/index.js";

test("API route contracts enforce identity, scope, and origin policy", async () => {
  const route = defineRoute({ method: "POST", path: "/api/items", auth: "user", scope: "items:write", csrf: true, handler: () => Response.json({ ok: true }) });
  const denied = await dispatchRoutes(new Request("https://example.test/api/items", { method: "POST" }), { DB: {} }, {}, { user: null }, [route]);
  assert.equal(denied.status, 401);
  const crossSite = await dispatchRoutes(new Request("https://example.test/api/items", { method: "POST", headers: { Origin: "https://evil.test" } }), { DB: {} }, {}, { user: { authUser: { id: "u1", provider: "oidc", subject: "s1" } } }, [route]);
  assert.equal(crossSite.status, 403);
});

test("repositories provide named relations over scoped data readers", async () => {
  const calls = [];
  const env = { data: { tenant: { async list(name, options) { calls.push({ name, options }); return name === "ingredients" ? [{ id: "i1", recipe_id: "r1" }] : [{ id: "r1" }]; }, async get(name, id) { return { id, name }; }, async count() { return 1; }, async insert() {}, async update() {}, async delete() {} } } };
  const repos = createRepositories(env, [defineRepository({ name: "recipes", resource: "recipes", relations: { ingredients: { repository: "ingredients", foreignKey: "recipe_id" } } }), defineRepository({ name: "ingredients", resource: "ingredients" })]);
  assert.deepEqual(await repos.recipes.link("ingredients", { id: "r1" }), [{ id: "i1", recipe_id: "r1" }]);
  assert.equal(calls[0].options.where.recipe_id, "r1");
});

test("app registration supports empty and read-only workers", () => {
  assert.deepEqual(defineApp({ name: "ingest" }), { name: "ingest", features: [], domains: [], readOnlyDomains: [], records: [] });
  assert.deepEqual(defineApp(), { name: "worker", features: [], domains: [], readOnlyDomains: [], records: [] });
});

test("application manifests isolate and freeze SDK registrations", () => {
  const features = [defineFeature("llm")];
  const domains = [];
  const app = defineApp({ name: "immutable", features, domains });
  features.push(defineFeature("messaging"));
  assert.equal(app.features.length, 1);
  assert.equal(Object.isFrozen(app), true);
  assert.equal(Object.isFrozen(app.features), true);
  assert.equal(Object.isFrozen(app.domains), true);
  assert.throws(() => app.features.push(defineFeature("messaging")), TypeError);
});

test("AppDomain registers downstream routes without imposing admin access", async () => {
  class CookbookDomain extends AppDomain {
    constructor() {
      super({ name: "cookbook.recipes", basePath: "/api/recipes", auth: "public" });
      this.route({ method: "GET", path: "/:recipeId", handler: ({ params }) => Response.json({ id: params.recipeId }) });
    }
  }
  const worker = createWorker({ app: defineApp({ name: "cookbook", domains: [new CookbookDomain()] }), fetch: () => new Response("missing", { status: 404 }) });
  const response = await worker.fetch(new Request("https://example.test/api/recipes/soup"), {}, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: "soup" });
});

test("read-only domains reject mutating routes at worker construction", () => {
  class PublishedDomain extends AppDomain {
    constructor() {
      super({ name: "published", basePath: "/api/published", auth: "public" });
      this.route({ method: "GET", handler: () => new Response("ok") });
      this.route({ method: "POST", handler: () => new Response("no") });
    }
  }
  assert.throws(
    () => createWorker({ app: defineApp({ readOnlyDomains: [new PublishedDomain()] }), fetch: () => new Response("app") }),
    /Read-only domain published cannot register POST routes/,
  );
});

test("read-only domains receive read-only data and database contexts", async () => {
  const db = {
    prepare() { return { bind() { return this; }, all: async () => ({ results: [] }) }; },
    batch() { throw new Error("batch should not be called"); },
  };
  class PublishedDomain extends AppDomain {
    constructor() {
      super({ name: "published-records", basePath: "/api/published-records", auth: "public", dataResources: [{
        name: "published", table: "published", scope: "public", columns: ["id", "tenant_id", "title"],
        readableColumns: ["id", "title"], writableColumns: ["title"],
      }] });
      this.route({ method: "GET", handler: async ({ env, state }) => {
        let dataBlocked = false;
        let sqlBlocked = false;
        try { await state.data.tenant.insert("published", { id: "one", title: "No" }); } catch { dataBlocked = true; }
        try { env.DB.prepare("INSERT INTO published (id) VALUES (?)"); } catch { sqlBlocked = true; }
        return Response.json({ dataBlocked, sqlBlocked });
      } });
    }
  }
  const worker = createWorker({
    app: defineApp({ readOnlyDomains: [new PublishedDomain()] }),
    fetch: () => new Response("app"),
  });
  const response = await worker.fetch(new Request("https://example.test/api/published-records"), { DB: db }, {});
  assert.deepEqual(await response.json(), { dataBlocked: true, sqlBlocked: true });
});

test("read-only data facades preserve reads and reject all data writes", async () => {
  const calls = [];
  const reader = {
    user: { context: async () => ({}), list: async () => [{ id: "one" }], page: async () => ({ rows: [], nextCursor: null }), count: async () => 1, get: async () => null, insert: async () => calls.push("insert"), update: async () => calls.push("update"), updateWhere: async () => calls.push("updateWhere"), delete: async () => calls.push("delete"), deleteWhere: async () => calls.push("deleteWhere") },
    tenant: {}, public: {}, system: {}, context: async () => ({}), resources: [],
  };
  const readOnly = createReadOnlyDataReader(reader);
  assert.deepEqual(await readOnly.user.list("items"), [{ id: "one" }]);
  for (const operation of ["insert", "update", "updateWhere", "delete", "deleteWhere"]) {
    await assert.rejects(readOnly.user[operation]("items"), /read-only/);
  }
  assert.deepEqual(calls, []);
  assert.throws(() => readOnlyD1({ prepare: () => ({}) }).prepare("UPDATE items SET title=?"), /Read-only/);
});

test("apps activate only the built-in features they request", async () => {
  class LlmStatusDomain extends AppDomain {
    constructor() {
      super({ name: "cookbook.llm-status", basePath: "/", auth: "public" });
      this.route({ method: "GET", handler: () => new Response("llm enabled") });
    }
  }
  const worker = createWorker({
    app: defineApp({ name: "cookbook", features: [defineFeature("llm", { domains: [new LlmStatusDomain()] })] }),
    fetch: () => new Response("app"),
  });
  assert.equal(await (await worker.fetch(new Request("https://example.test/"), {}, {})).text(), "llm enabled");
  assert.deepEqual(resolveFeatures([defineFeature("messaging")]).map((feature) => feature.name), ["messaging"]);
  assert.throws(() => resolveFeatures(["unknown"]), /Unknown built-in feature/);
});

test("duplicate feature registrations fail", () => {
  assert.throws(() => resolveFeatures(["llm", { name: "llm" }]), /Duplicate feature/);
});

test("removed createWorker registration options fail explicitly", () => {
  for (const removed of ["features", "featureOptions", "auth", "repositories", "apiRoutes", "scopes", "scopeRoutes", "subscriptionManifest", "dataResources"]) {
    assert.throws(() => createWorker({ fetch: () => new Response("app"), [removed]: [] }), new RegExp(`createWorker\\.${removed} was removed`));
  }
});
