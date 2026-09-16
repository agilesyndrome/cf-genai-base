import { useCallback, useEffect, useState } from "react";
import { apiFetch, apiJson } from "../../api/client.js";

export function useApiResource(path, { enabled = true, initialValue = null } = {}) {
  const [value, setValue] = useState(initialValue);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    if (!enabled) return null;
    setLoading(true);
    try { const next = await apiFetch(path); setValue(next); setError(null); return next; }
    catch (cause) { setError(cause); throw cause; }
    finally { setLoading(false); }
  }, [enabled, path]);
  useEffect(() => { reload().catch(() => {}); }, [reload]);
  return { value, setValue, loading, error, reload };
}

export function useMutation(path, { method = "POST" } = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mutate = useCallback(async (payload = {}) => {
    setLoading(true);
    try { const result = await apiJson(path, payload, { method }); setError(null); return result; }
    catch (cause) { setError(cause); throw cause; }
    finally { setLoading(false); }
  }, [method, path]);
  return { mutate, loading, error };
}

export function ResourceState({ loading, error, empty = "Nothing to show.", children }) {
  if (loading) return <p className="cf-ui-status" role="status">Loading…</p>;
  if (error) return <p className="cf-ui-error" role="alert">{error.message || "Unable to load data."}</p>;
  return children || <p className="cf-ui-status">{empty}</p>;
}

export function StatusBadge({ state }) {
  const value = String(state || "unknown").toLowerCase();
  return <span className={`cf-ui-status-badge cf-ui-status-${value}`}>{value}</span>;
}
