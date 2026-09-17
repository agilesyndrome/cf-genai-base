import test from "node:test";
import assert from "node:assert/strict";
import { authGroups, authUsers, createAuth, OAUTH_SINGLE } from "../src/index.js";
import { dispatchRoutes } from "../src/api/contracts.js";

const env = {
  OIDC_DISCOVERY_URL: "https://issuer.example/.well-known/openid-configuration",
  OIDC_ISSUER: "https://issuer.example",
  OIDC_CLIENT_ID: "client-id",
  OIDC_CLIENT_SECRET: "client-secret",
  AUTH_SESSION_SECRET: "a-secret-at-least-32-bytes-long-123",
};

function request(path, init = {}) {
  return new Request(`https://site.example${path}`, init);
}

function authRoute(auth, requestValue, environment) {
  return dispatchRoutes(requestValue, environment, {}, {}, auth.domains.flatMap((domain) => domain.routes));
}

function authRouteHandler(auth, path, environment) {
  const route = auth.domains.flatMap((domain) => domain.routes).find((candidate) => candidate.path === path);
  return route.handler({ request: request(path), env: environment, ctx: {}, state: {}, identity: {}, params: {} });
}

function canonicalEnv(source = env) {
  return {
    ...source,
    DB: {
      prepare(sql) {
        const statement = {
          bind(...values) { statement.values = values; return statement; },
          async first() {
            if (sql.includes("SELECT * FROM auth_users")) return { id: "auth-1", provider: "oauth", subject: "subject", email: "person@example.com", display_name: "Person", is_admin: 1 };
            return null;
          },
          async run() { return { success: true }; },
        };
        return statement;
      },
      async batch() { return []; },
    },
  };
}

test("auth is the base OAUTH_SINGLE feature", () => {
  const auth = createAuth();
  assert.equal(auth.strategy, OAUTH_SINGLE);
  assert.equal(auth.packageName, "@agilesyndrome/cf-genai-base");
  assert.equal(OAUTH_SINGLE, "OAUTH_SINGLE");
});

test("shared route contract exposes unauthenticated API behavior", async () => {
  const auth = createAuth({ publicPaths: ["/", "/health", "/api/public/"] });
  const me = await authRoute(auth, request("/api/me"), env);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: null });

  const protectedResponse = await auth.handle(request("/api/private"), env);
  assert.equal(protectedResponse.status, 401);

  assert.equal(await auth.handle(request("/api/public/catalog"), env), null);
});

test("mutating requests require same-origin protection", async () => {
  const auth = createAuth({ publicPaths: ["/"], allowedOrigins: ["https://admin.example"] });
  assert.equal((await auth.handle(request("/api/private", { method: "POST" }), env)).status, 403);
  assert.equal((await auth.handle(request("/api/private", { method: "POST", headers: { Origin: "https://evil.example" } }), env)).status, 403);
  assert.equal(await auth.handle(request("/api/private", { method: "POST", headers: { Origin: "https://site.example" } }), env).then((response) => response.status), 401);
});

test("login uses provider discovery and PKCE", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), "https://issuer.example/.well-known/openid-configuration");
    return Response.json({
      issuer: "https://issuer.example/",
      authorization_endpoint: "https://issuer.example/authorize",
      token_endpoint: "https://issuer.example/token",
      jwks_uri: "https://issuer.example/keys",
    });
  };
  try {
    const auth = createAuth({ publicPaths: ["/"] });
    const response = await authRoute(auth, request("/auth/login?return_to=https%3A%2F%2Fevil.example"), env);
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get("Location"));
    assert.equal(location.origin, "https://issuer.example");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.ok(location.searchParams.get("nonce"));
    assert.match(response.headers.get("Set-Cookie"), /__Host-cfgenai_state=/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discovery rejects issuer substitution and insecure provider endpoints", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ issuer: "https://evil.example/", authorization_endpoint: "https://issuer.example/authorize", token_endpoint: "https://issuer.example/token", jwks_uri: "https://issuer.example/keys" });
    const substituted = createAuth();
    await assert.rejects(() => authRouteHandler(substituted, "/auth/login", { ...env, OIDC_ISSUER: "https://issuer.example", OIDC_DISCOVERY_URL: "https://discovery-proxy.example/.well-known/openid-configuration" }), /unexpected issuer/);

    globalThis.fetch = async () => Response.json({ issuer: "https://second-issuer.example/", authorization_endpoint: "https://second-issuer.example/authorize", token_endpoint: "http://second-issuer.example/token", jwks_uri: "https://second-issuer.example/keys" });
    const insecure = createAuth();
    await assert.rejects(() => authRouteHandler(insecure, "/auth/login", { ...env, OIDC_ISSUER: "https://second-issuer.example", OIDC_DISCOVERY_URL: "https://second-issuer.example/.well-known/openid-configuration" }), /invalid token endpoint/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discovery validates required JSON fields before use", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    issuer: "https://malformed.example/",
    authorization_endpoint: "https://malformed.example/authorize",
    token_endpoint: 42,
    jwks_uri: "https://malformed.example/keys",
  });
  try {
    const auth = createAuth();
    await assert.rejects(
      () => authRouteHandler(auth, "/auth/login", {
        ...env,
        OIDC_ISSUER: "https://malformed.example",
        OIDC_DISCOVERY_URL: "https://malformed.example/.well-known/openid-configuration",
      }),
      /missing token_endpoint/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects unsafe cookie prefixes", () => {
  assert.throws(() => createAuth({ cookiePrefix: "bad; Domain=evil.example" }), /cookiePrefix/);
});

test("OIDC discovery URL has no issuer fallback", async () => {
  const { OIDC_DISCOVERY_URL: _removed, ...issuerOnly } = env;
  const auth = createAuth();
  await assert.rejects(() => authRouteHandler(auth, "/auth/login", issuerOnly), /OIDC_DISCOVERY_URL is not configured/);
});

test("authorize hook can restrict an authenticated route", async () => {
  const auth = createAuth({ publicPaths: ["/"], authorize: ({ user }) => user.email === "admin@example.com" });
  const response = await auth.handle(request("/admin"), env);
  assert.equal(response.status, 302);
});

test("valid signed sessions do not throw during authorization", async () => {
  const payload = btoa(JSON.stringify({ sub: "subject", exp: Math.floor(Date.now() / 1000) + 300 })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const auth = createAuth({ publicPaths: ["/"], authorize: () => false });
  const response = await auth.handle(request("/admin", { headers: { Cookie: `__Host-cfgenai_session=${payload}.${signature}` } }), canonicalEnv());
  assert.equal(response.status, 403);
});

test("signed sessions with invalid field types are rejected", async () => {
  const payload = btoa(JSON.stringify({ sub: "subject", exp: "tomorrow" })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const auth = createAuth({ publicPaths: ["/"] });
  const response = await auth.handle(request("/api/private", { headers: { Cookie: `__Host-cfgenai_session=${payload}.${signature}` } }), canonicalEnv());
  assert.equal(response.status, 401);
});

test("authenticated sessions hydrate the canonical base auth user", async () => {
  const statements = [];
  const envWithDb = {
    ...env,
    DB: {
      prepare(sql) {
        const statement = {
          bind(...values) { statement.values = values; return statement; },
          async first() {
            if (sql.includes("SELECT * FROM auth_users WHERE provider=?")) return { id: "auth-1", provider: "oauth", subject: "subject", email: "person@example.com", display_name: "Person", is_admin: 1 };
            return null;
          },
          async run() { statements.push({ sql, values: statement.values }); return { success: true }; },
        };
        return statement;
      },
      async batch(batchStatements) { statements.push(...batchStatements); return []; },
    },
  };
  const payload = btoa(JSON.stringify({ sub: "subject", email: "person@example.com", name: "Person", email_verified: true, auth_strategy: "oauth", exp: Math.floor(Date.now() / 1000) + 300 })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const auth = createAuth({ publicPaths: ["/"] });
  const user = await auth.getUser(request("/api/me", { headers: { Cookie: `__Host-cfgenai_session=${payload}.${signature}` } }), envWithDb);
  assert.equal(user.authUser.id, "auth-1");
  assert.equal(user.authUser.is_admin, true);
  assert.equal(statements.length, 0);
});

test("auth registers canonical repositories and exposes a minimal public identity", async () => {
  const payload = btoa(JSON.stringify({ sub: "subject", email: "person@example.com", name: "Person", exp: Math.floor(Date.now() / 1000) + 300 })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const auth = createAuth({ publicPaths: ["/"] });
  assert.deepEqual(
    [...authUsers.repositories, ...authGroups.repositories].map((repository) => repository.name),
    ["users", "groups"],
  );
  const response = await authRoute(auth, request("/api/me", { headers: { Cookie: `__Host-cfgenai_session=${payload}.${signature}` } }), canonicalEnv());
  assert.deepEqual(await response.json(), { user: { id: "auth-1", email: "person@example.com", name: "Person", isAdmin: true } });
});

test("sessionAuthorize can revoke an existing session", async () => {
  const payload = btoa(JSON.stringify({ sub: "subject", exp: Math.floor(Date.now() / 1000) + 300 })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const auth = createAuth({ sessionAuthorize: () => false, publicPaths: ["/"] });
  const response = await auth.handle(request("/api/private", { headers: { Cookie: `__Host-cfgenai_session=${payload}.${signature}` } }), canonicalEnv());
  assert.equal(response.status, 401);
});
