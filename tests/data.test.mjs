import assert from "node:assert/strict";
import test from "node:test";
import { DataScopeError, createDataReader, normalizeDataResources } from "../src/data.js";

function database() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = { args: [], bind(...args) { this.args = args; return this; }, async all() { calls.push({ sql, args: this.args }); return { results: [{ id: "recipe-1", title: "Soup" }] }; }, async first() { calls.push({ sql, args: this.args }); return /COUNT/.test(sql) ? { count: 1 } : null; }, async run() { calls.push({ sql, args: this.args }); return { success: true }; } };
      return statement;
    },
  };
}

const recipes = {
  name: "recipes",
  table: "recipes",
  scope: "tenant",
  columns: ["id", "tenant_id", "title"],
  writableColumns: ["id", "title"],
};

test("tenant reader applies the tenant predicate without exposing tenant mechanics to callers", async () => {
  const db = database();
  const reader = createDataReader({ DB: db }, { resources: [recipes], context: { userId: "user-1", tenantId: "tenant-a", system: false } });
  assert.deepEqual(await reader.tenant.list("recipes", { where: { title: "Soup" } }), [{ id: "recipe-1", title: "Soup" }]);
  assert.match(db.calls[0].sql, /FROM "recipes" WHERE "tenant_id"=\?/);
  assert.deepEqual(db.calls[0].args, ["tenant-a", "Soup"]);
  const page = await reader.tenant.page("recipes", { limit: 1 });
  assert.equal(page.nextCursor, "recipe-1");
  assert.deepEqual(await reader.user.list("recipes"), []);
});

test("tenant writes bind ownership and cannot be replaced by caller data", async () => {
  const db = database();
  const reader = createDataReader({ DB: db }, { resources: [recipes], context: { userId: "user-1", tenantId: "tenant-a", system: false } });
  await reader.tenant.insert("recipes", { id: "recipe-1", tenant_id: "tenant-b", title: "Soup" });
  assert.deepEqual(db.calls[0].args, ["recipe-1", "Soup", "tenant-a"]);
  await assert.rejects(() => reader.user.update("recipes", "recipe-1", { title: "Nope" }), DataScopeError);
});

test("resource registration requires ownership columns", () => {
  assert.throws(() => normalizeDataResources([{ name: "recipes", table: "recipes", scope: "tenant", columns: ["id", "title"] }]), /tenant_id/);
  assert.throws(() => normalizeDataResources([{ name: "settings", table: "settings", scope: "system", columns: ["id"], operations: ["update"] }]), /invalid operations/);
});

test("system reader is the only reader allowed to access system resources", async () => {
  const db = database();
  const reader = createDataReader({ DB: db }, { resources: [{ name: "settings", table: "settings", scope: "system", columns: ["id", "value"], writableColumns: ["id", "value"] }], context: { userId: "user-1", tenantId: "tenant-a", system: true } });
  assert.equal((await reader.system.list("settings"))[0].id, "recipe-1");
  assert.match(db.calls[0].sql, /FROM "settings" LIMIT/);
  assert.deepEqual(await reader.tenant.list("settings"), []);
});

test("public tenant reads require an explicitly public resource and tenant", async () => {
  const db = database();
  const reader = createDataReader({ DB: db }, { resources: [{ ...recipes, publicRead: true }], context: { tenantId: "tenant-a", public: true, system: false } });
  assert.equal((await reader.tenant.list("recipes"))[0].id, "recipe-1");
  const privateReader = createDataReader({ DB: db }, { resources: [recipes], context: { tenantId: "tenant-a", public: true, system: false } });
  assert.deepEqual(await privateReader.tenant.list("recipes"), []);
});

test("base enforces column capabilities even on tenant writes", async () => {
  const db = database();
  const resource = { ...recipes, columnScopes: { title: "recipe:publish-public" } };
  const reader = createDataReader({ DB: db }, { resources: [resource], context: { userId: "user-1", tenantId: "tenant-a", scopes: [] } });
  await assert.rejects(() => reader.tenant.update("recipes", "recipe-1", { title: "Nope" }), DataScopeError);
  const scopedReader = createDataReader({ DB: db }, { resources: [resource], context: { userId: "user-1", tenantId: "tenant-a", scopes: ["recipe:publish-public"] } });
  await scopedReader.tenant.update("recipes", "recipe-1", { title: "Allowed" });
});
