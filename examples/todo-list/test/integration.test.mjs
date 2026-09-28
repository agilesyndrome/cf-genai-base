import assert from "node:assert/strict";
import test from "node:test";
import { createSqliteD1, repositoryMigrations } from "../../../tests/sqlite-d1.mjs";
import worker from "../src/index.ts";

function d1() {
  return createSqliteD1({
    migrations: [...repositoryMigrations(import.meta.url), new URL("../migrations/0013_todo_seed.sql", import.meta.url)],
  });
}

const auth = (user) => ({ Authorization: `Basic ${btoa(`${user}:todo-demo`)}` });
const ctx = { waitUntil() {} };

async function request(env, user, path, method = "GET", body, headers = {}) {
  const response = await worker.fetch(new Request(`https://todo.test${path}`, {
    method,
    headers: { ...(user ? auth(user) : {}), ...headers,
      ...(method === "GET" ? {} : { Origin: "https://todo.test" }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, ctx);
  return { status: response.status, json: await response.json() };
}

test("v6 managed todo list reads only published revisions in the active tenant", async () => {
  const env = { DB: d1() };
  const page = await worker.fetch(new Request("https://todo.test/", { headers: auth("alice") }), env, ctx);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Stamp/);
  const list = await request(env, "alice", "/api/todos");
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.records.map((todo) => todo.id), ["nw-1", "nw-2"]);
  assert.equal(list.json.records.find((todo) => todo.id === "nw-2").content.done, true);
  const other = env.DB.prepare("SELECT COUNT(*) AS count FROM data_object_records WHERE tenant_id = ? AND object_type = ?")
    .bind("contoso", "todos").first();
  assert.equal(other.count, 2, "The other tenant's rows exist but are not exposed");
  assert.equal((await request(env, "alice", "/api/todos", "GET", undefined, { "X-Tenant-ID": "contoso" })).status, 403);
  assert.equal((await request(env, null, "/api/todos")).status, 401);
  const crossSite = await worker.fetch(new Request("https://todo.test/api/todos", {
    method: "POST", headers: { ...auth("alice"), Origin: "https://other.test", "Content-Type": "application/json" },
    body: JSON.stringify({ content: { title: "Nope", done: false } }),
  }), env, ctx);
  assert.equal(crossSite.status, 403);
  env.DB.close();
});

test("create, save, publish and unpublish use explicit immutable revisions", async () => {
  const env = { DB: d1() };
  const created = await request(env, "alice", "/api/todos", "POST", { content: { title: "Draft task", done: false } });
  assert.equal(created.status, 201);
  const id = created.json.id;
  assert.equal((await request(env, "alice", `/api/todos/${id}`)).status, 404);
  assert.equal((await request(env, "alice", `/api/todos/${id}/draft`)).json.revision, 1);
  assert.equal((await request(env, "alice", `/api/todos/${id}/publish`, "POST", { revision: 1 })).status, 200);
  const saved = await request(env, "alice", `/api/todos/${id}`, "PUT", { expectedRevision: 1, content: { title: "Done task", done: true } });
  assert.equal(saved.json.revision, 2);
  assert.equal((await request(env, "alice", `/api/todos/${id}`)).json.content.done, false);
  assert.equal((await request(env, "alice", `/api/todos/${id}/publish`, "POST", { revision: 2 })).status, 200);
  assert.equal((await request(env, "alice", `/api/todos/${id}`)).json.content.done, true);
  assert.deepEqual((await request(env, "alice", `/api/todos/${id}/versions`)).json.versions.map((version) => version.revision), [2, 1]);
  assert.equal((await request(env, "alice", `/api/todos/${id}`, "PUT", { expectedRevision: 1, content: { title: "Stale", done: false } })).status, 409);
  assert.equal((await request(env, "carol", `/api/todos/${id}`, "PUT", { expectedRevision: 2, content: { title: "Intrusion", done: false } })).status, 409);
  assert.equal((await request(env, "alice", `/api/todos/${id}/publish`, "DELETE")).status, 200);
  assert.equal((await request(env, "alice", `/api/todos/${id}`)).status, 404);
  assert.equal((await request(env, "alice", `/api/todos/${id}/draft`)).status, 200);
  env.DB.close();
});

test("passport visibility and repeatable ratings are enforced through generated APIs", async () => {
  const env = { DB: d1() };
  const id = "nw-2";
  const first = await request(env, "alice", `/api/todos/${id}/ratings`, "POST", { value: "fine" });
  assert.equal(first.status, 201);
  const second = await request(env, "alice", `/api/todos/${id}/ratings`, "POST", { value: "great", visibility: "tenant" });
  assert.equal(second.status, 201);
  assert.equal((await request(env, "alice", `/api/todos/${id}/passport`)).json.ratings.length, 2);
  assert.equal((await request(env, "bob", `/api/todos/${id}/ratings`)).json.ratings.length, 1);
  assert.equal((await request(env, "bob", `/api/todos/${id}/passports`)).json.stamps.length, 0);
  assert.equal((await request(env, "alice", "/api/todos/passport")).json.stamps.length, 1);
  assert.equal((await request(env, "alice", `/api/todos/${id}/passport`, "PUT", { visibility: "tenant" })).status, 200);
  assert.equal((await request(env, "bob", `/api/todos/${id}/passports`)).json.stamps.length, 1);
  assert.equal((await request(env, "alice", `/api/todos/${id}/ratings`, "POST", { value: "not-in-scale" })).status, 400);
  assert.equal((await request(env, "alice", `/api/todos/${id}/ratings`, "POST", { value: "great", visibility: "public" })).status, 400);
  assert.equal((await request(env, "carol", `/api/todos/${id}/ratings`)).status, 404);
  const count = env.DB.prepare("SELECT COUNT(*) AS count FROM data_object_passports WHERE tenant_id = ? AND record_id = ? AND user_id = ?")
    .bind("northwind", id, "northwind-alice").first();
  assert.equal(count.count, 1);
  env.DB.close();
});
