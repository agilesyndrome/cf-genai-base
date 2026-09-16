import { escapeHtml, htmlResponse } from "../ui/server.js";
import { adminNavigation } from "./navigation.js";

export function adminPage({ title = "Administration", active = "", items = [], content = "" } = {}) {
  return htmlResponse(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title><main><header><h1>${escapeHtml(title)}</h1>${adminNavigation(items, active)}</header><section>${content}</section></main>`);
}
