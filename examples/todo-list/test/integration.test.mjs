import assert from "node:assert/strict";
import test from "node:test";
import { createSqliteD1, repositoryMigrations } from "../../../tests/sqlite-d1.mjs";
import worker from "../src/index.ts";

function d1() {
  return createSqliteD1({
    migrations: [...repositoryMigrations(import.meta.url), new URL("../migrations/0009_todo_list.sql", import.meta.url)],
    seed(database) {
      database.exec(`
        INSERT OR IGNORE INTO auth_tenants (id, name) VALUES ('northwind', 'Northwind'), ('contoso', 'Contoso');
        INSERT OR IGNORE INTO auth_users (id, provider, subject, email, display_name, is_admin) VALUES
          ('northwind-alice', 'basic', 'alice', 'alice@northwind.test', 'Alice Northwind', 0),
          ('northwind-bob', 'basic', 'bob', 'bob@northwind.test', 'Bob Northwind', 0),
          ('contoso-carol', 'basic', 'carol', 'carol@contoso.test', 'Carol Contoso', 0),
          ('contoso-dan', 'basic', 'dan', 'dan@contoso.test', 'Dan Contoso', 0);
        INSERT OR IGNORE INTO auth_user_tenants (user_id, tenant_id) VALUES
          ('northwind-alice', 'northwind'), ('northwind-bob', 'northwind'),
          ('contoso-carol', 'contoso'), ('contoso-dan', 'contoso');
        INSERT OR IGNORE INTO auth_scopes (name, label, description, system) VALUES
          ('todos:read', 'Read todos', '', 0), ('todos:write', 'Write todos', '', 0),
          ('todos:publish', 'Publish todos', '', 0);
        INSERT OR IGNORE INTO auth_user_scopes (user_id, scope_name) SELECT users.id, scopes.name
          FROM auth_users users CROSS JOIN auth_scopes scopes;
      `);
    },
  });
}

const auth = (user) => ({ Authorization: `Basic ${btoa(`${user}:todo-demo`)}` });
const ctx = { waitUntil() {} };

test("todo API lists only the caller tenant and keeps completed rows", async () => {
  const env = { DB: d1() };
  const response = await worker.fetch(new Request("https://todo.test/api/todos", { headers: auth("alice") }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.records.map((record) => record.id), ["nw-1", "nw-2"]);
  assert.equal(body.records.find((record) => record.id === "nw-2").content.workflow_state, "done");
  const otherTenant = env.DB.prepare("SELECT COUNT(*) AS count FROM data_records WHERE tenant_id = ?").bind("contoso").first();
  assert.equal(otherTenant.count, 2, "D1 still contains the other tenant's rows; the API did not leak them");
});

test("tenant header cannot escape the authenticated membership", async () => {
  const response = await worker.fetch(new Request("https://todo.test/api/todos", { headers: { ...auth("alice"), "X-Tenant-ID": "contoso" } }), { DB: d1() }, ctx);
  assert.equal(response.status, 403);
});

test("unauthenticated API requests are rejected", async () => {
  const response = await worker.fetch(new Request("https://todo.test/api/todos"), { DB: d1() }, ctx);
  assert.equal(response.status, 401);
});
