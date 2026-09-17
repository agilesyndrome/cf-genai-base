import { useCallback, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { apiFetch, apiJson, type JsonObject, type JsonValue } from "../../api/client.js";

export interface ApiResourceOptions { enabled?: boolean; initialValue?: JsonObject | null }
export interface ApiResource {
  value: JsonObject | null;
  setValue: Dispatch<SetStateAction<JsonObject | null>>;
  loading: boolean;
  error: unknown;
  reload: () => Promise<JsonObject | null>;
}

export function useApiResource(path: string, { enabled = true, initialValue = null }: ApiResourceOptions = {}): ApiResource {
  const [value, setValue] = useState<JsonObject | null>(initialValue);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async (): Promise<JsonObject | null> => {
    if (!enabled) return null;
    setLoading(true);
    try {
      const next = await apiFetch(path, { validateJson: isJsonObject });
      const object = next instanceof Response ? null : next;
      setValue(object);
      setError(null);
      return object;
    } catch (cause: unknown) {
      setError(cause);
      throw cause;
    } finally { setLoading(false); }
  }, [enabled, path]);
  useEffect(() => { void reload().catch(() => undefined); }, [reload]);
  return { value, setValue, loading, error, reload };
}

export interface MutationOptions { method?: string }
export interface MutationResource { mutate: (payload?: JsonObject) => Promise<JsonValue | Response>; loading: boolean; error: unknown }

export function useMutation(path: string, { method = "POST" }: MutationOptions = {}): MutationResource {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mutate = useCallback(async (payload: JsonObject = {}): Promise<JsonValue | Response> => {
    setLoading(true);
    try { const result = await apiJson(path, payload, { method }); setError(null); return result; }
    catch (cause: unknown) { setError(cause); throw cause; }
    finally { setLoading(false); }
  }, [method, path]);
  return { mutate, loading, error };
}

export interface ResourceStateProps { loading: boolean; error: unknown; empty?: string; children?: ReactNode }

export function ResourceState({ loading, error, empty = "Nothing to show.", children }: ResourceStateProps): ReactNode {
  if (loading) return <p className="cf-ui-status" role="status">Loading…</p>;
  if (error) return <p className="cf-ui-error" role="alert">{error instanceof Error ? error.message : "Unable to load data."}</p>;
  return children || <p className="cf-ui-status">{empty}</p>;
}

export interface StatusBadgeProps { state: unknown }
export function StatusBadge({ state }: StatusBadgeProps) {
  const value = String(state || "unknown").toLowerCase();
  return <span className={`cf-ui-status-badge cf-ui-status-${value}`}>{value}</span>;
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every(isJsonValue);
}
function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}
