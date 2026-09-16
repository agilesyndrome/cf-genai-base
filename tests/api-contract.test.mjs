import assert from "node:assert/strict";
import test from "node:test";
import { createRepositories, defineRepository } from "../src/repository.js";
import { defineApp } from "../src/app.js";
import { defineRoute, dispatchRoutes } from "../src/api/contracts.js";

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

test("app registration supports API-only workers", () => {
  assert.deepEqual(defineApp({ name: "ingest", ui: false, api: true, admin: false }), { name: "ingest", ui: false, api: true, admin: false, features: [], repositories: [] });
  assert.throws(() => defineApp({ name: "empty", ui: false, api: false }), /ui or api/);
});
