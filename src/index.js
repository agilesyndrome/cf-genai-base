/**
 * Lean, opinionated Worker composition for Cloudflare sites.
 * Site code owns domain routes and data; this owns lifecycle and edge concerns.
 */
export function createWorker({ fetch, scheduled, auth, health, boot, metrics, security = true }) {
  if (typeof fetch !== "function") throw new TypeError("createWorker requires a fetch handler");
  return {
    async fetch(request, env, ctx) {
      try {
        if (boot) await boot(env, { request, ctx });
        const url = new URL(request.url);
        const authResponse = auth ? await auth(request, env, ctx) : null;
        let response = authResponse;
        if (!response) {
          if (url.pathname === "/health" || url.pathname === "/api/health") {
            const details = health ? await health(env, { request, ctx }) : {};
            response = healthResponse(env, details);
          } else {
            response = await fetch(request, env, ctx);
          }
        }
        if (metrics) metrics.request(request, response, env, ctx);
        return security ? secureResponse(response) : response;
      } catch (error) {
        console.error("[worker] request failed", error);
        return secureResponse(Response.json({ error: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } }));
      }
    },
    ...(scheduled ? { scheduled } : {}),
  };
}

export function validateBoot(env, { bindings = [], required = [] } = {}) {
  const missingBindings = bindings.filter((name) => !env?.[name]);
  const missingValues = required.filter((name) => !env?.[name] || String(env[name]).startsWith("replace-with-"));
  return { ok: missingBindings.length === 0 && missingValues.length === 0, missingBindings, missingValues };
}

export function assertBoot(env, spec = {}) {
  const result = validateBoot(env, spec);
  if (!result.ok) throw new Error(`Worker boot validation failed: ${[...result.missingBindings, ...result.missingValues].join(", ")}`);
  return result;
}

export function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function methodNotAllowed(allow = "GET") {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: allow } });
}

export function healthResponse(env, details = {}) {
  return Response.json({ ok: true, version: String(env.BUILD_SHA || "unknown").slice(0, 7), build_number: env.BUILD_NUMBER ? String(env.BUILD_NUMBER) : null, ...details }, { headers: { "Cache-Control": "no-store" } });
}

export function createMetrics({ tokenEnv = "POSTHOG_TOKEN", host = "https://us.i.posthog.com" } = {}) {
  return {
    request(request, response, env, ctx) {
      if (!env?.[tokenEnv] || !ctx?.waitUntil || new URL(request.url).pathname === "/health") return;
      const event = response.status >= 500 ? "server_error" : "request";
      ctx.waitUntil(track(env, event, { path: new URL(request.url).pathname, method: request.method, status: response.status }, { tokenEnv, host }));
    },
    track: (env, event, properties, ctx) => ctx?.waitUntil?.(track(env, event, properties, { tokenEnv, host })),
  };
}

async function track(env, event, properties, { tokenEnv, host }) {
  try {
    const token = String(env?.[tokenEnv] || "");
    if (!token) return;
    await fetch(`${host.replace(/\/+$/, "")}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: token, event, properties: { ...properties, distinct_id: properties?.distinct_id || "anonymous" } }) });
  } catch (error) {
    console.error("[metrics] delivery failed", error);
  }
}
