import assert from "node:assert/strict";
import test from "node:test";
import { createSqliteD1 } from "./sqlite-d1.mjs";
import { VersionedObjectDomain, VersionedObjectStore, ObjectAccessError } from "../src/data/objects.js";

const migrations = ["0001_authorization", "0004_tenants", "0011_versioned_objects"]
  .map((name) => new URL(`../migrations/${name}.sql`, import.meta.url));

function setup() {
  const DB = createSqliteD1({ migrations });
  for (const [id, tenant] of [["alice", "easley-family"], ["bob", "other"]]) {
    DB.prepare("INSERT INTO auth_users (id, provider, subject) VALUES (?, 'test', ?)").bind(id, id).run();
    if (tenant === "other") DB.prepare("INSERT INTO auth_tenants (id, name) VALUES ('other', 'Other')").run();
  }
  const store = new VersionedObjectStore({ name: "recipes", basePath: "/api/recipes", fields: { title: "string", score: "number" }, publicRead: true, publishScope: "recipes:publish" });
  return { DB, store, alice: { userId: "alice", tenantId: "easley-family", scopes: ["recipes:publish"] }, bob: { userId: "bob", tenantId: "other", scopes: ["recipes:publish"] } };
}

test("saving creates immutable snapshots while published readers retain the chosen revision", async () => {
  const { DB, store, alice } = setup();
  const created = await store.create({ DB }, alice, { title: "Soup", score: 1 });
  assert.equal(await store.read({ DB }, alice, created.id), null);
  await store.publish({ DB }, alice, created.id, 1);
  const saved = await store.save({ DB }, alice, created.id, 1, { title: "Better soup", score: 2 });
  assert.equal(saved.revision, 2);
  assert.equal((await store.read({ DB }, { publicTenantId: "easley-family" }, created.id)).content.title, "Soup");
  assert.equal((await store.read({ DB }, alice, created.id, true)).content.title, "Better soup");
  assert.equal((await store.list({ DB }, { publicTenantId: "easley-family" }))[0].revision, 1);
  assert.deepEqual((await store.versions({ DB }, alice, created.id)).map((version) => version.revision), [2, 1]);
  await store.publish({ DB }, alice, created.id, 2);
  assert.equal((await store.read({ DB }, alice, created.id)).revision, 2);
  await store.unpublish({ DB }, alice, created.id);
  assert.equal(await store.read({ DB }, alice, created.id), null);
  DB.close();
});

test("expected revisions, scopes, schema and tenant boundaries fail closed", async () => {
  const { DB, store, alice, bob } = setup();
  const record = await store.create({ DB }, alice, { title: "Soup" });
  await assert.rejects(store.save({ DB }, alice, record.id, 1, { title: "No", unexpected: true }), /Invalid field/);
  await store.save({ DB }, alice, record.id, 1, { title: "Second" });
  await assert.rejects(store.save({ DB }, alice, record.id, 1, { title: "Stale" }), (error) => error instanceof ObjectAccessError && error.status === 409);
  assert.equal((await store.versions({ DB }, alice, record.id)).length, 2);
  await assert.rejects(store.publish({ DB }, { ...alice, scopes: [] }, record.id, 2), (error) => error.status === 403);
  await assert.rejects(store.publish({ DB }, alice, record.id, 3), (error) => error.status === 404);
  assert.equal(await store.read({ DB }, bob, record.id, true), null);
  await assert.rejects(store.save({ DB }, bob, record.id, 1, { title: "Cross tenant" }), (error) => error.status === 409);
  assert.equal((await store.versions({ DB }, bob, record.id)).length, 0);
  DB.close();
});

test("domain exposes managed routes without a generic update repository", () => {
  const domain = new VersionedObjectDomain({ name: "recipes", basePath: "/api/recipes", fields: { title: "string" } });
  assert.deepEqual(domain.routes.map((route) => `${route.method} ${route.path}`), [
    "GET /api/recipes", "POST /api/recipes", "PUT /api/recipes/:id", "POST /api/recipes/:id/publish",
    "DELETE /api/recipes/:id/publish", "GET /api/recipes/:id/versions", "GET /api/recipes/:id/draft", "GET /api/recipes/:id",
  ]);
  assert.equal(domain.repositories.length, 0);
  assert.equal(domain.routes.find((route) => route.path === "/api/recipes/:id" && route.method === "GET").auth, "public");
});

test("generated handlers return published content and reject stale saves", async () => {
  const { DB, alice } = setup();
  const domain = new VersionedObjectDomain({ name: "recipes", basePath: "/api/recipes", fields: { title: "string" }, publicRead: true });
  const call = async (method, path, payload, actor = alice) => {
    const route = domain.routes.find((candidate) => candidate.method === method && candidate.path === path);
    const request = new Request("https://example.test/api/recipes", {
      method, ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
    });
    return route.handler({ request, env: { DB }, state: { data: { context: async () => actor } }, params: { id: call.id } });
  };
  const created = await (await call("POST", "/api/recipes", { content: { title: "Soup" } })).json();
  call.id = created.id;
  const unpublished = await call("GET", "/api/recipes/:id", undefined, { publicTenantId: "easley-family" });
  assert.equal(unpublished.status, 404);
  await call("POST", "/api/recipes/:id/publish", { revision: 1 });
  const published = await call("GET", "/api/recipes/:id", undefined, { publicTenantId: "easley-family" });
  assert.equal((await published.json()).content.title, "Soup");
  const stale = await call("PUT", "/api/recipes/:id", { expectedRevision: 0, content: { title: "No" } });
  assert.equal(stale.status, 400);
  DB.close();
});
