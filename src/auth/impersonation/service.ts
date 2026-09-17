import { base64url, base64urlDecode, constantTimeEqual, signValue } from "../encoding.js";
import type {
  ImpersonationEnvironment,
  ImpersonationTokenOptions,
  ImpersonationTokenPayload,
} from "./model.js";
import { isImpersonationPayload, normalizeImpersonationTtl } from "./validation.js";

export async function createImpersonationToken(
  env: ImpersonationEnvironment,
  adminUserId: unknown,
  targetUserId: unknown,
  { ttlSeconds = 900 }: ImpersonationTokenOptions = {},
): Promise<string> {
  if (!env.AUTH_SESSION_SECRET) {
    throw new Error("AUTH_SESSION_SECRET is required for impersonation.");
  }
  const payload: ImpersonationTokenPayload = {
    adminUserId: String(adminUserId || "admin"),
    targetUserId: String(targetUserId),
    exp: Math.floor(Date.now() / 1000) + normalizeImpersonationTtl(ttlSeconds),
  };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${await signValue(encoded, env.AUTH_SESSION_SECRET)}`;
}

export async function verifyImpersonationToken(
  token: unknown,
  env: ImpersonationEnvironment,
): Promise<ImpersonationTokenPayload | null> {
  if (!env.AUTH_SESSION_SECRET) return null;
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) return null;
  const expected = await signValue(encoded, env.AUTH_SESSION_SECRET);
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded)));
    return isImpersonationPayload(payload) ? payload : null;
  } catch {
    return null;
  }
}
