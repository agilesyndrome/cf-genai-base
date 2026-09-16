export function sameOrigin(request, allowedOrigins = []) {
  const origin = request?.headers?.get("Origin");
  if (!origin) return false;
  const requestOrigin = (() => { try { return new URL(request.url).origin; } catch { return ""; } })();
  const allowed = new Set((Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins]).filter(Boolean).map(String));
  if (!allowed.size && requestOrigin) allowed.add(requestOrigin);
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return allowed.has(origin) && (!fetchSite || fetchSite === "same-origin");
}

export async function readJsonClone(request, maxBytes = 64 * 1024) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return { error: secureJson({ error: "JSON request required" }, 415) };
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { error: secureJson({ error: "Request body is too large" }, 413) };
  try {
    const value = await request.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Object required");
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) return { error: secureJson({ error: "Request body is too large" }, 413) };
    return { value };
  } catch {
    return { error: secureJson({ error: "Invalid JSON object request" }, 400) };
  }
}

export async function readJson(request, maxBytes = 64 * 1024) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) throw Object.assign(new Error("JSON request required"), { status: 415 });
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
  if (!request.body) throw Object.assign(new Error("Request body required"), { status: 400 });
  try {
    const value = await request.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Object required");
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    return value;
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error("Invalid JSON object request"), { status: 400 });
  }
}

export function secureJson(payload, status = 200, headers = {}) {
  return secureResponse(Response.json(payload, { status, headers: { "Cache-Control": "no-store", ...headers } }));
}

export function json(payload, status = 200, cache = "no-store") {
  return secureJson(payload, status, { "Cache-Control": cache });
}

export function secureText(text, status = 200, cache = "no-store") {
  return secureResponse(new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": cache } }));
}

export function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function requireUser(identity, response = secureJson({ error: "Authentication is required." }, 401)) {
  return identity ? null : response;
}

export function requireAdmin(identity, response = secureJson({ error: "Administrator access is required." }, 403)) {
  return identity?.is_admin || identity?.isAdmin ? null : response;
}
