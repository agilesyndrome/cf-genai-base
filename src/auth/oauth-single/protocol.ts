import { base64url, decodeBase64Url } from "./cookies.js";
import type {
  OAuthClaims,
  OAuthEnvironment,
  OAuthOptions,
  OidcConfiguration,
} from "./model.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const configurationCache = new Map<string, { value: OidcConfiguration; exp: number }>();
const configurationRequests = new Map<string, Promise<OidcConfiguration>>();
const jwksCache = new Map<string, { value: JsonWebKeySet; exp: number }>();
const jwksRequests = new Map<string, Promise<JsonWebKeySet>>();
const OIDC_CACHE_MS = 15 * 60 * 1000;
const OIDC_TIMEOUT_MS = 10_000;

interface SigningJsonWebKey extends JsonWebKey { kid?: string }
interface JsonWebKeySet { keys: SigningJsonWebKey[] }

export async function configuration(
  env: OAuthEnvironment,
  options: OAuthOptions = {},
): Promise<OidcConfiguration> {
  const discoveryUrl = required(env, envNameFor(options, "discoveryUrl", "OIDC_DISCOVERY_URL"));
  if (new URL(discoveryUrl).protocol !== "https:") throw new Error("OIDC discovery URL must use HTTPS");

  const expectedIssuer = normalizeIssuer(required(env, envNameFor(options, "issuer", "OIDC_ISSUER")));
  const cacheKey = `${discoveryUrl}\0${expectedIssuer}`;
  const cached = configurationCache.get(cacheKey);
  if (cached && cached.exp > Date.now()) return cached.value;
  const existing = configurationRequests.get(cacheKey);
  if (existing) return existing;

  const pending = fetchWithTimeout(discoveryUrl).then(async (response) => {
    if (!response.ok) throw new Error("Unable to load OIDC configuration");
    const value = readOidcConfiguration(await response.json());
    if (!value.issuer || new URL(value.issuer).protocol !== "https:" || normalizeIssuer(value.issuer) !== expectedIssuer) {
      throw new Error("OIDC configuration returned an unexpected issuer");
    }
    requireHttpsEndpoint(value.authorization_endpoint, "authorization");
    requireHttpsEndpoint(value.token_endpoint, "token");
    requireHttpsEndpoint(value.jwks_uri, "JWKS");
    configurationCache.set(cacheKey, { value, exp: Date.now() + OIDC_CACHE_MS });
    return value;
  }).finally(() => configurationRequests.delete(cacheKey));
  configurationRequests.set(cacheKey, pending);
  return pending;
}

export async function verifyIdToken(
  token: unknown,
  config: OidcConfiguration,
  clientId: string,
  expectedNonce: string | undefined,
): Promise<OAuthClaims> {
  const [head, body, signature] = String(token || "").split(".");
  if (!head || !body || !signature) throw new Error("Malformed ID token");

  const header = readObject(JSON.parse(decoder.decode(decodeBase64Url(head))));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported ID token signature");
  const keys = await getJwks(config.jwks_uri);
  const jwk = keys.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) throw new Error("ID token signing key was not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const validSignature = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(signature),
    encoder.encode(`${head}.${body}`),
  );
  if (!validSignature) throw new Error("Invalid ID token");

  const claims = readOAuthClaims(JSON.parse(decoder.decode(decodeBase64Url(body))));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const validAuthorizedParty = !Array.isArray(claims.aud)
    || claims.aud.length < 2
    || claims.azp === clientId;
  if (
    normalizeIssuer(claims.iss || "") !== normalizeIssuer(config.issuer)
    || !audience.includes(clientId)
    || !validAuthorizedParty
    || typeof claims.exp !== "number"
    || claims.exp <= Date.now() / 1000
    || claims.nonce !== expectedNonce
    || !claims.sub
  ) {
    throw new Error("Invalid ID token claims");
  }
  return claims;
}

export async function sign(
  value: string,
  env: OAuthEnvironment,
  name: string,
  encoded = true,
): Promise<string> {
  const secret = required(env, name);
  if (name === "AUTH_SESSION_SECRET" && secret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must be at least 32 characters");
  }
  const data = encoded ? base64url(encoder.encode(value)) : value;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
  return encoded ? `${data}.${signature}` : signature;
}

export function required(env: OAuthEnvironment, key: string): string {
  if (!env[key] || String(env[key]).startsWith("replace-with-")) {
    throw new Error(`${key} is not configured`);
  }
  return String(env[key]);
}

export function envNameFor(options: OAuthOptions, key: string, fallback: string): string {
  return options.env?.[key] || fallback;
}

export function random(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function callbackUrl(request: Request, env: OAuthEnvironment, options: OAuthOptions): string {
  const configuredOrigin = env[envNameFor(options, "publicOrigin", "PUBLIC_ORIGIN")];
  const origin = configuredOrigin ? new URL(String(configuredOrigin)).origin : new URL(request.url).origin;
  return `${origin}/auth/callback`;
}

async function getJwks(uri: string): Promise<JsonWebKeySet> {
  const cached = jwksCache.get(uri);
  if (cached && cached.exp > Date.now()) return cached.value;
  const existing = jwksRequests.get(uri);
  if (existing) return existing;

  const pending = fetchWithTimeout(uri).then(async (response) => {
    if (!response.ok) throw new Error("Unable to load OIDC signing keys");
    const value = readJsonWebKeySet(await response.json());
    jwksCache.set(uri, { value, exp: Date.now() + OIDC_CACHE_MS });
    return value;
  }).finally(() => jwksRequests.delete(uri));
  jwksRequests.set(uri, pending);
  return pending;
}

function fetchWithTimeout(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: AbortSignal.timeout(OIDC_TIMEOUT_MS) });
}

function normalizeIssuer(value: string): string {
  return String(value).replace(/\/+$/, "") + "/";
}

function requireHttpsEndpoint(value: string, label: string): void {
  if (!value || new URL(value).protocol !== "https:") {
    throw new Error(`OIDC configuration returned an invalid ${label} endpoint`);
  }
}

function readObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OIDC response must be a JSON object");
  }
  return Object.fromEntries(Object.entries(value));
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`OIDC response is missing ${key}`);
  return value;
}

function readOidcConfiguration(value: unknown): OidcConfiguration {
  const input = readObject(value);
  return {
    issuer: requiredString(input, "issuer"),
    authorization_endpoint: requiredString(input, "authorization_endpoint"),
    token_endpoint: requiredString(input, "token_endpoint"),
    jwks_uri: requiredString(input, "jwks_uri"),
  };
}

function readOAuthClaims(value: unknown): OAuthClaims {
  const input = readObject(value);
  const audience = input.aud;
  if (audience !== undefined && typeof audience !== "string"
    && !(Array.isArray(audience) && audience.every((item) => typeof item === "string"))) {
    throw new Error("Invalid ID token audience");
  }
  for (const key of ["sub", "email", "name", "iss", "azp", "nonce"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "string") throw new Error(`Invalid ID token ${key}`);
  }
  if (input.exp !== undefined && typeof input.exp !== "number") throw new Error("Invalid ID token exp");
  if (input.email_verified !== undefined && typeof input.email_verified !== "boolean") {
    throw new Error("Invalid ID token email_verified");
  }
  return {
    ...input,
    sub: typeof input.sub === "string" ? input.sub : undefined,
    email: typeof input.email === "string" ? input.email : undefined,
    name: typeof input.name === "string" ? input.name : undefined,
    email_verified: typeof input.email_verified === "boolean" ? input.email_verified : undefined,
    iss: typeof input.iss === "string" ? input.iss : undefined,
    aud: typeof audience === "string" || Array.isArray(audience) ? audience : undefined,
    azp: typeof input.azp === "string" ? input.azp : undefined,
    exp: typeof input.exp === "number" ? input.exp : undefined,
    nonce: typeof input.nonce === "string" ? input.nonce : undefined,
  };
}

function isSigningJsonWebKey(value: unknown): value is SigningJsonWebKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const kty = Reflect.get(value, "kty");
  const kid = Reflect.get(value, "kid");
  return typeof kty === "string" && (kid === undefined || typeof kid === "string");
}

function readJsonWebKeySet(value: unknown): JsonWebKeySet {
  const input = readObject(value);
  if (!Array.isArray(input.keys) || !input.keys.every(isSigningJsonWebKey)) {
    throw new Error("OIDC signing keys response is invalid");
  }
  return { keys: input.keys };
}
