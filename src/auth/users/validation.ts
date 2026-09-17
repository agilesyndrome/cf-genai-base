import type { UserIdentityInput } from "./model.js";

export function normalizeUserIdentity(value: unknown): UserIdentityInput | null {
  if (!value || typeof value !== "object") return null;
  const input = Object.fromEntries(Object.entries(value));
  const sub = typeof input.sub === "string" ? input.sub.trim() : "";
  if (!sub) return null;
  const email = String(input.email ?? "").trim().toLowerCase();
  return {
    ...input,
    sub,
    email,
    name: String(input.name ?? (email || sub)),
    auth_strategy: String(input.auth_strategy ?? "oauth"),
  } satisfies UserIdentityInput;
}

export function validateUserId(value: unknown): string {
  const userId = String(value ?? "").trim();
  if (!userId) throw new TypeError("User id is required.");
  return userId;
}
