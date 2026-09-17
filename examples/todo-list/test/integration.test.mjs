import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.ts";

// This adapter intentionally records and executes the small SQL subset used by the
// example. In CI, replace it with a Wrangler/D1 binding to run the same assertions
// against a real local SQLite D1 database.
function d1() {
  const tables = {
    todo_items: [
      { id: "nw-1", tenant_id: "northwind", owner_id: "northwind-alice", title: "Buy coffee", done: 0 },
      { id: "nw-2", tenant_id: "northwind", owner_id: "northwind-bob", title: "Review the launch checklist", done: 1 },
      { id: "co-1", tenant_id: "contoso", owner_id: "contoso-carol", title: "Send the weekly update", done: 0 },
    ],
    auth_users: [], auth_user_tenants: [], auth_user_scopes: [], auth_tenants: [], auth_scopes: [],
  };
  return {
    tables,
    prepare(sql) {
      const statement = { args: [], bind(...args) { this.args = args; return this; }, async all() {
        if (sql.includes('FROM "todo_items"')) {
          const tenant = this.args[0];
          return { results: tables.todo_items.filter((row) => row.tenant_id === tenant).map(({ id, owner_id, title, done, created_at, updated_at }) => ({ id, owner_id, title, done, created_at, updated_at })) };
        }
        if (sql.includes("FROM auth_tenants t JOIN auth_user_tenants") ) {
          const memberships = { "northwind-alice": "northwind", "northwind-bob": "northwind", "contoso-carol": "contoso", "contoso-dan": "contoso" };
          const tenant = memberships[this.args[0]];
          return { results: tenant ? [{ id: tenant, name: tenant }] : [] };
        }
        if (sql.includes("FROM auth_user_scopes")) return { results: ["todos:read", "todos:create", "todos:update", "todos:delete"].map((scope_name) => ({ scope_name })) };
        return { results: [] };
      }, async first() {
        if (sql.includes("FROM auth_users WHERE provider")) {
          const users = { alice: ["northwind-alice", "alice@northwind.test", "Alice Northwind"], bob: ["northwind-bob", "bob@northwind.test", "Bob Northwind"], carol: ["contoso-carol", "carol@contoso.test", "Carol Contoso"], dan: ["contoso-dan", "dan@contoso.test", "Dan Contoso"] };
          const [id, email, display_name] = users[this.args[1]] || [];
          return id ? { id, provider: "basic", subject: this.args[1], email, display_name, is_admin: 0 } : null;
        }
        if (sql.includes("FROM auth_user_scopes")) return { user_id: this.args[0], scope_name: this.args[1] };
        if (sql.includes('FROM "todo_items"')) return tables.todo_items.find((row) => row.id === this.args.at(-1)) || null;
        return null;
      }, async run() { return { meta: { changes: 1, last_row_id: this.args[0] } }; } };
      return statement;
    },
    async batch() {},
  };
}

const auth = (user) => ({ Authorization: `Basic ${btoa(`${user}:todo-demo`)}` });
const ctx = { waitUntil() {} };

test("todo API lists only the caller tenant and keeps completed rows", async () => {
  const env = { DB: d1() };
  const response = await worker.fetch(new Request("https://todo.test/api/todos", { headers: auth("alice") }), env, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tenantId, "northwind");
  assert.deepEqual(body.todos.map((todo) => todo.id), ["nw-1", "nw-2"]);
  assert.equal(body.todos.find((todo) => todo.id === "nw-2").done, 1);
  assert.equal(env.DB.tables.todo_items.filter((todo) => todo.tenant_id === "contoso").length, 1, "D1 still contains the other tenant's rows; the API did not leak them");
});

test("tenant header cannot escape the authenticated membership", async () => {
  const response = await worker.fetch(new Request("https://todo.test/api/todos", { headers: { ...auth("alice"), "X-Tenant-ID": "contoso" } }), { DB: d1() }, ctx);
  assert.equal(response.status, 403);
});

test("unauthenticated API requests are rejected", async () => {
  const response = await worker.fetch(new Request("https://todo.test/api/todos"), { DB: d1() }, ctx);
  assert.equal(response.status, 401);
});
