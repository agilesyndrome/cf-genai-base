import { secureResponse } from "../core/security.js";

export function escapeHtml(value) { return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character])); }

export function htmlResponse(html, { status = 200, headers = {} } = {}) {
  return secureResponse(new Response(String(html), { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers } }));
}

export function notFoundPage({ title = "Not found", message = "The requested page could not be found." } = {}) {
  return htmlResponse(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main>`, { status: 404 });
}
