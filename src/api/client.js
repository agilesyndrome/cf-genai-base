export async function apiFetch(input, options = {}) {
  const response = await fetch(input, { credentials: "same-origin", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }, ...options });
  const payload = await response.clone().json().catch(() => null);
  if (!response.ok) { const error = new Error(payload?.error || `Request failed (${response.status})`); error.status = response.status; error.requestId = response.headers.get("X-Request-ID") || payload?.request_id || null; throw error; }
  return payload === null ? response : payload;
}

export function apiJson(input, payload, options = {}) { return apiFetch(input, { ...options, method: options.method || "POST", body: JSON.stringify(payload) }); }
