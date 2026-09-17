import assert from "node:assert/strict";
import test from "node:test";
import { AppDomain, createWorker, defineApp } from "../src/index.js";
import { authTenants, authUsers } from "../src/auth/index.js";
import { coreCircuitBreakers } from "../src/core/index.js";

class ExampleDomain extends AppDomain {
  initialized = 0;

  constructor() {
    super({
      name: "example.records",
      basePath: "/api/records",
      dataResources: [{ name: "records" }],
      repositories: [{ name: "records", resource: "records" }],
    });
    this.view("list", ({ records }) => records.length);
    this.route({
      method: "GET",
      path: "/:recordId",
      scopes: ["records:read", "records:preview"],
      scopeMode: "any",
      authorize: ({ request }) => request.headers.get("X-Allow") === "yes",
      handler: ({ params }) => Response.json({ id: params.recordId }),
    });
  }

  initialize() {
    this.initialized += 1;
  }
}

test("AppDomain keeps model-adjacent capabilities in one manifest", () => {
  const domain = new ExampleDomain();
  assert.deepEqual(domain.dataResources, [{ name: "records" }]);
  assert.deepEqual(domain.repositories, [{ name: "records", resource: "records" }]);
  assert.equal(domain.getView("list")({ records: [1, 2] }), 2);
  assert.deepEqual(domain.routes[0].scopes, ["records:read", "records:preview"]);
  assert.equal(domain.routes[0].scopeMode, "any");
});

test("custom domain policy participates in the shared Hono dispatcher", async () => {
  class PolicyDomain extends AppDomain {
    constructor() {
      super({ name: "example.policy", basePath: "/api/policy" });
      this.route({
        method: "GET",
        authorize: ({ request }) => request.headers.get("X-Allow") === "yes",
        handler: () => Response.json({ ok: true }),
      });
    }
  }
  const worker = createWorker({
    app: defineApp({ name: "example", domains: [new PolicyDomain()] }),
    fetch: () => new Response("not found", { status: 404 }),
  });
  const denied = await worker.fetch(new Request("https://example.test/api/policy"), {}, {});
  const allowed = await worker.fetch(new Request("https://example.test/api/policy", {
    headers: { "X-Allow": "yes" },
  }), {}, {});
  assert.equal(denied.status, 403);
  assert.equal(allowed.status, 200);
});

test("duplicate domains fail during worker construction", () => {
  assert.throws(
    () => createWorker({
      app: defineApp({ name: "example", domains: [new ExampleDomain(), new ExampleDomain()] }),
      fetch: () => new Response("site"),
    }),
    /domain twice/,
  );
});

test("built-in administration routes declare delegated read and mutation capabilities", () => {
  assert.deepEqual(authUsers.routes.find((route) => route.path === "/api/admin/users").scopes, ["users:read"]);
  assert.deepEqual(authUsers.routes.find((route) => route.path.endsWith("/scopes") && route.method === "PUT").scopes, ["users:manage"]);
  assert.deepEqual(authTenants.routes.find((route) => route.method === "DELETE").scopes, ["tenants:delete"]);
  assert.deepEqual(coreCircuitBreakers.routes.find((route) => route.method === "PUT").scopes, ["operations:manage"]);
});
