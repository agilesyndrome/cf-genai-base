import type { JsonObject, JsonValue } from "./api/client.js";

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.values(value).every(isJsonValue);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

/**
 * Normalize a text field at an application boundary.
 *
 * The helper deliberately does not HTML-escape or otherwise rewrite user
 * content. Callers should choose the appropriate output encoding later.
 */
export function cleanText(
  value: unknown,
  { maxLength = 10_000, required = false, label = "Value" }: {
    maxLength?: number;
    required?: boolean;
    label?: string;
  } = {},
): string {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw Object.assign(new Error(`${label} must be text.`), { status: 400 });
  }
  const text = String(value ?? "").replaceAll("\u0000", "").trim();
  if (text.length > maxLength) {
    throw Object.assign(new Error(`${label} must be ${maxLength} characters or fewer.`), { status: 400 });
  }
  if (required && !text) {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  return text;
}

export function positiveId(value: unknown, label = "ID"): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw Object.assign(new Error(`${label} must be a positive integer.`), { status: 400 });
  }
  return id;
}

/** Encode JSON for safe placement inside an inline script element. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
