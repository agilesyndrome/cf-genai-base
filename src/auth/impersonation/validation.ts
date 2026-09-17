import type { ImpersonationTokenPayload } from "./model.js";

export function normalizeImpersonationTtl(value: unknown): number {
  return Math.min(Math.max(Number(value) || 900, 60), 3600);
}

export function isImpersonationPayload(value: unknown): value is ImpersonationTokenPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ImpersonationTokenPayload>;
  return typeof payload.adminUserId === "string"
    && typeof payload.targetUserId === "string"
    && payload.targetUserId.length > 0
    && typeof payload.exp === "number"
    && payload.exp > Date.now() / 1000;
}
