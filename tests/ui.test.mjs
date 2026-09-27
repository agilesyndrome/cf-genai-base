import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_DASHBOARD_SECTIONS, ADMIN_SYSTEM_LINKS, AdminDashboard, AdminOverview, recordArrayField, recordField } from "../src/ui/react/index.ts";
import { renderSiteDocument } from "../src/ui/ssr.tsx";
import { jsx } from "hono/jsx";

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
    "audit-log",
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

test("UI response readers accept circuit-breaker healthcheck IDs", () => {
  const response = {
    circuit_breakers: [{
      id: "llm:llm-models",
      feature: "llm",
      name: "llm-models",
      display_name: "LLM model access",
      state: "on",
      healthcheck_mode: "any",
      allow_self_healing: true,
      healthchecks: ["llm:configuration", "llm:llm-models"],
      depends_on_circuit_breakers: [],
      metadata: {},
    }],
  };
  assert.deepEqual(recordArrayField(response, "circuit_breakers"), response.circuit_breakers);
  assert.deepEqual(recordArrayField({ features: [{ feature: "llm", package_name: "base", version: "5.0.4", health: "green", healthchecks: [], circuit_breakers: response.circuit_breakers, circuit_breaker: response.circuit_breakers[0] }] }, "features").length, 1);
});

test("site document rendering owns metadata while callers own content", () => {
  const html = renderSiteDocument({
    title: "GTA Adventures",
    description: "Travel notes",
    canonicalUrl: "https://gta.example/toronto",
    themeColor: "#164e63",
    stylesheets: ["/site.css"],
    scripts: [{ src: "/site.js", type: "module" }],
    children: jsx("main", {}, "A < safe visit"),
  });
  assert.match(html, /<title>GTA Adventures<\/title>/);
  assert.match(html, /name="description" content="Travel notes"/);
  assert.match(html, /rel="canonical" href="https:\/\/gta\.example\/toronto"/);
  assert.match(html, /href="\/site\.css"/);
  assert.match(html, /src="\/site\.js" type="module"/);
  assert.match(html, /A &lt; safe visit/);
});
