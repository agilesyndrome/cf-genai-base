import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../src/index.js";
import { validateGroupInput, validateGroupNames } from "../src/auth/groups/index.js";

const ctx = { waitUntil() {} };

function groupDatabase() {
  const group = { name: "recipe:author", display_name: "Recipe authors", description: "Can author recipes", created_at: "now", updated_at: "now" };
  return {
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("FROM auth_users WHERE provider")) return { id: "admin-1", email: "admin@example.test", display_name: "Admin", is_admin: 1 };
          if (sql.includes("FROM auth_groups WHERE name")) return group;
          return null;
        },
        async all() {
          if (sql.includes("FROM auth_groups ORDER")) return { results: [group] };
          if (sql.includes("auth_user_groups") && sql.includes("JOIN auth_users")) return { results: [] };
          return { results: [] };
        },
        async run() { return {}; },
      };
      return statement;
    },
    async batch() {},
  };
}

test("group domain validation produces stable capability-shaped input", () => {
  assert.deepEqual(validateGroupInput({ name: "recipe:author", display_name: "Recipe authors" }), {
    name: "recipe:author",
    display_name: "Recipe authors",
    description: "",
  });
  assert.deepEqual(validateGroupNames(["recipe:author", "recipe:author"]), ["recipe:author"]);
  assert.throws(() => validateGroupInput({ name: "Not A Group", display_name: "Nope" }), /lowercase/);
});

test("group admin API is registered by the auth group resource", async () => {
  const worker = createWorker({ fetch: async () => new Response("site") });
  const request = new Request("https://example.test/api/admin/groups/recipe%3Aauthor", {
    headers: { Authorization: `Basic ${btoa("admin:secret")}` },
  });
  const response = await worker.fetch(request, { ADMIN_TOKEN: "secret", DB: groupDatabase() }, ctx);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).group.name, "recipe:author");
});
