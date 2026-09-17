import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_DASHBOARD_SECTIONS, ADMIN_SYSTEM_LINKS, AdminDashboard, AdminOverview, recordArrayField, recordField } from "../src/ui/react/index.ts";

test("the UI exports one complete administration dashboard", () => {
  assert.equal(typeof AdminDashboard, "function");
  assert.equal(typeof AdminOverview, "function");
  assert.deepEqual(ADMIN_DASHBOARD_SECTIONS, [
    "home",
    "users",
    "tenants",
    "groups",
    "scopes",
    "subscriptions",
    "jobs",
    "features",
    "healthchecks",
    "circuit-breakers",
  ]);
  assert.deepEqual(ADMIN_SYSTEM_LINKS.map((link) => link.key), ADMIN_DASHBOARD_SECTIONS);
});

test("UI response readers narrow valid records and reject malformed nested values", () => {
  const response = { users: [{ id: "user-1", email: "one@example.test", tenants: [{ id: "tenant-1", name: "One" }] }] };
  assert.deepEqual(recordArrayField(response, "users"), response.users);
  assert.deepEqual(recordField({ user: response.users[0] }, "user"), response.users[0]);
  assert.deepEqual(recordArrayField({ users: [{ id: "user-1", tenants: 4 }] }, "users"), []);
  assert.equal(recordField({ user: "not-an-object" }, "user"), null);
});
