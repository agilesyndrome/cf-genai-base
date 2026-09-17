import type { ComponentType, ReactNode } from "react";
import type { JsonObject, JsonValue } from "../../api/client.js";

export interface UiRecord {
  id?: string; name?: string; type?: string; status?: string; state?: string; feature?: string; component?: string;
  display_name?: string; email?: string; provider?: string; is_admin?: boolean | number; description?: string; label?: string;
  system?: boolean | number; package_name?: string; version?: string; health?: string; healthcheck_mode?: string;
  allow_self_healing?: boolean | number; user_count?: number; created_at?: string; updated_at?: string; createdAt?: string;
  updatedAt?: string; group_name?: string; scope_name?: string; entitlement?: string; value?: JsonValue; progress?: JsonValue;
  result?: JsonValue; error?: JsonValue; scopes?: readonly (string | UiRecord)[]; tenants?: readonly UiRecord[];
  groups?: readonly UiRecord[]; users?: readonly UiRecord[]; healthchecks?: readonly UiRecord[]; circuit_breakers?: readonly UiRecord[];
  entitlements?: readonly UiRecord[]; circuit_breaker?: UiRecord | null;
}

export interface AdminLinkItem { key: string; label: string; href: string }
export interface AdminSelection { key: string; id: string | null }
export interface ApplicationAdminSection {
  key: string; label: string; href?: string;
  render?: (selection: AdminSelection) => ReactNode;
  component?: ComponentType<{ selection: AdminSelection }>;
}

export function recordValue(value: JsonValue | undefined): UiRecord | null { return isUiRecord(value) ? value : null; }
export function recordField(value: JsonObject | null, key: string): UiRecord | null { return value ? recordValue(value[key]) : null; }
export function recordArray(value: JsonValue | undefined): UiRecord[] { return Array.isArray(value) && value.every(isUiRecord) ? [...value] : []; }
export function recordArrayField(value: JsonObject | null, key: string): UiRecord[] { return recordArray(value?.[key]); }

function isUiRecord(value: unknown): value is UiRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const stringFields = ["id", "name", "type", "status", "state", "feature", "component", "display_name", "email", "provider", "description", "label", "package_name", "version", "health", "healthcheck_mode", "created_at", "updated_at", "createdAt", "updatedAt", "group_name", "scope_name", "entitlement"];
  const scalarFields = ["is_admin", "system", "allow_self_healing"];
  const recordArrays = ["tenants", "groups", "users", "healthchecks", "circuit_breakers", "entitlements"];
  if (!stringFields.every((key) => optionalString(value, key))) return false;
  if (!scalarFields.every((key) => optionalBooleanNumber(value, key))) return false;
  const userCount: unknown = Reflect.get(value, "user_count");
  if (userCount !== undefined && typeof userCount !== "number") return false;
  if (!recordArrays.every((key) => optionalRecordArray(value, key))) return false;
  const scopes: unknown = Reflect.get(value, "scopes");
  if (scopes !== undefined && (!Array.isArray(scopes) || !scopes.every((scope) => typeof scope === "string" || isUiRecord(scope)))) return false;
  const circuit: unknown = Reflect.get(value, "circuit_breaker");
  if (circuit !== undefined && circuit !== null && !isUiRecord(circuit)) return false;
  return ["value", "progress", "result", "error"].every((key) => { const field: unknown = Reflect.get(value, key); return field === undefined || isJsonValue(field); });
}
function optionalString(value: object, key: string): boolean { const field: unknown = Reflect.get(value, key); return field === undefined || typeof field === "string"; }
function optionalBooleanNumber(value: object, key: string): boolean { const field: unknown = Reflect.get(value, key); return field === undefined || typeof field === "boolean" || typeof field === "number"; }
function optionalRecordArray(value: object, key: string): boolean { const field: unknown = Reflect.get(value, key); return field === undefined || (Array.isArray(field) && field.every(isUiRecord)); }
function isJsonValue(value: unknown): value is JsonValue { if (value === null || typeof value === "string" || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (Array.isArray(value)) return value.every(isJsonValue); return typeof value === "object" && Object.values(value).every(isJsonValue); }
