import { escapeHtml } from "../ui/server.js";

export function adminNavigation(items = [], active = "") {
  return `<nav aria-label="Administration">${items.map((item) => `<a href="${escapeHtml(item.href)}"${item.key === active ? " aria-current=page" : ""}>${escapeHtml(item.label)}</a>`).join("")}</nav>`;
}
