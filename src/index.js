/**
 * Small, opinionated Worker composition layer shared by the Easley Owl sites.
 * Site code owns routing and data access; this owns lifecycle and the edges.
 */
export function createWorker({ fetch, scheduled, auth, security = true }) {
  return {
    async fetch(request, env, ctx) {
      try {
        const authResponse = auth ? await auth(request, env, ctx) : null;
        const response = authResponse || await fetch(request, env, ctx);
        return security ? secureResponse(response) : response;
      } catch (error) {
        console.error("[worker] request failed", error);
        return secureResponse(Response.json({ error: "Internal server error" }, { status: 500 }));
      }
    },
    ...(scheduled ? { scheduled } : {}),
  };
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
  return Response.json({
    ok: true,
    version: String(env.BUILD_SHA || "unknown").slice(0, 7),
    build_number: env.BUILD_NUMBER ? String(env.BUILD_NUMBER) : null,
    ...details,
  }, { headers: { "Cache-Control": "no-store" } });
}
