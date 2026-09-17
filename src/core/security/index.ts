export type AllowedOriginInput = string | readonly string[];

export interface JsonObjectBody {
  readonly [key: string]: unknown;
}

export class SecurityRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SecurityRequestError";
    this.status = status;
  }
}

export type ReadJsonCloneResult =
  | { readonly value: JsonObjectBody; readonly error?: never }
  | { readonly error: Response; readonly value?: never };

export type ResponseHeaders = HeadersInit;

export interface IdentityLike {
  readonly is_admin?: boolean;
  readonly isAdmin?: boolean;
}

function isJsonObjectBody(value: unknown): value is JsonObjectBody {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function statusOf(error: unknown): number | null {
  if (error instanceof SecurityRequestError) return error.status;
  if (error instanceof Error && "status" in error) {
    const status = error.status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

export function sameOrigin(
  request: Request,
  allowedOrigins: AllowedOriginInput = [],
): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  const requestOrigin = (() => {
    try { return new URL(request.url).origin; } catch { return ""; }
  })();
  const origins = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
  const allowed = new Set(origins.filter(Boolean).map(String));
  if (!allowed.size && requestOrigin) allowed.add(requestOrigin);
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return allowed.has(origin) && (!fetchSite || fetchSite === "same-origin");
}

export async function readJsonClone(
  request: Request,
  maxBytes = 64 * 1024,
): Promise<ReadJsonCloneResult> {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return { error: secureJson({ error: "JSON request required" }, 415) };
  }
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { error: secureJson({ error: "Request body is too large" }, 413) };
  }
  try {
    const value = await readBoundedJson(request, maxBytes);
    if (!isJsonObjectBody(value)) throw new Error("Object required");
    return { value };
  } catch (error) {
    if (statusOf(error) === 413) return { error: secureJson({ error: "Request body is too large" }, 413) };
    return { error: secureJson({ error: "Invalid JSON object request" }, 400) };
  }
}

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<JsonObjectBody> {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    throw new SecurityRequestError("JSON request required", 415);
  }
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SecurityRequestError("Request body is too large", 413);
  }
  if (!request.body) throw new SecurityRequestError("Request body required", 400);
  try {
    const value = await readBoundedJson(request, maxBytes);
    if (!isJsonObjectBody(value)) throw new Error("Object required");
    return value;
  } catch (error) {
    if (statusOf(error) !== null) throw error;
    throw new SecurityRequestError("Invalid JSON object request", 400);
  }
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const reader = request.clone().body?.getReader();
  if (!reader) throw new SecurityRequestError("Request body required", 400);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      void reader.cancel().catch(() => {});
      throw new SecurityRequestError("Request body is too large", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export function secureJson(payload: unknown, status = 200, headers: ResponseHeaders = {}): Response {
  return secureResponse(Response.json(payload, { status, headers: { "Cache-Control": "no-store", ...headers } }));
}

export function json(payload: unknown, status = 200, cache = "no-store"): Response {
  return secureJson(payload, status, { "Cache-Control": cache });
}

export function secureText(text: string, status = 200, cache = "no-store"): Response {
  return secureResponse(new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": cache } }));
}

export function secureResponse(response: Response): Response {
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

export function requireUser(identity: IdentityLike | null | undefined, response = secureJson({ error: "Authentication is required." }, 401)): Response | null {
  return identity ? null : response;
}

export function requireAdmin(identity: IdentityLike | null | undefined, response = secureJson({ error: "Administrator access is required." }, 403)): Response | null {
  return identity?.is_admin || identity?.isAdmin ? null : response;
}
