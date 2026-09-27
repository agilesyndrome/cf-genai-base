import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminDashboard } from "./admin-dashboard.js";
import type { AdminSelection } from "./types.js";

export interface AdminBootstrapOptions {
  selector?: string;
  title?: string;
  onSelectionChange?: (selection: AdminSelection) => void;
}

const DEFAULT_ENABLED_SECTIONS = [
  "home",
  "users",
  "tenants",
  "groups",
  "scopes",
  "subscriptions",
  "jobs",
  "features",
  "healthchecks",
  "circuit-breakers",
  "audit-log",
];

const roots = new WeakMap<HTMLElement, Root>();

function sections(element: HTMLElement): string[] {
  return (element.dataset.enabledSections || DEFAULT_ENABLED_SECTIONS.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** Mount every declarative platform-admin root on the current document. */
export function mountAdminDashboards({
  selector = "[data-cf-admin-dashboard]",
  title = "Administration",
  onSelectionChange,
}: AdminBootstrapOptions = {}): void {
  for (const element of document.querySelectorAll<HTMLElement>(selector)) {
    if (roots.has(element)) continue;
    const root = createRoot(element);
    roots.set(element, root);
    try {
      root.render(createElement(AdminDashboard, {
        title,
        initialSection: element.dataset.initialSection || "home",
        enabledSections: sections(element),
        onSectionChange: onSelectionChange,
      }));
    } catch (error) {
      console.error("Could not mount the platform administration UI", error);
      element.innerHTML = '<p class="cf-ui-error" role="alert">The administration panel could not load. Please refresh and try again.</p>';
    }
  }
}
