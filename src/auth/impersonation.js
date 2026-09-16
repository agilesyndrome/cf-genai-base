import { base64url, base64urlDecode, constantTimeEqual, signValue } from "./encoding.js";

export async function createImpersonationToken(env, adminUserId, targetUserId, { ttlSeconds = 900 } = {}) {
  if (!env?.AUTH_SESSION_SECRET) throw new Error("AUTH_SESSION_SECRET is required for impersonation.");
  const payload = { adminUserId: String(adminUserId || "admin"), targetUserId: String(targetUserId), exp: Math.floor(Date.now() / 1000) + Math.min(Math.max(Number(ttlSeconds) || 900, 60), 3600) };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${await signValue(encoded, env?.AUTH_SESSION_SECRET || "")}`;
}

export async function verifyImpersonationToken(token, env) {
  if (!env?.AUTH_SESSION_SECRET) return null;
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || !constantTimeEqual(signature, await signValue(encoded, env?.AUTH_SESSION_SECRET || ""))) return null;
  try { const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded))); return payload.exp > Date.now() / 1000 && payload.targetUserId ? payload : null; } catch { return null; }
}
