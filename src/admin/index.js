import { escapeHtml, htmlResponse } from "../ui/server.js";

export function adminNavigation(items = [], active = "") {
  return `<nav aria-label="Administration">${items.map((item) => `<a href="${escapeHtml(item.href)}"${item.key === active ? " aria-current=page" : ""}>${escapeHtml(item.label)}</a>`).join("")}</nav>`;
}

export function adminPage({ title = "Administration", active = "", items = [], content = "" } = {}) {
  return htmlResponse(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><main><header><h1>${escapeHtml(title)}</h1>${adminNavigation(items, active)}</header><section>${content}</section></main>`);
}
