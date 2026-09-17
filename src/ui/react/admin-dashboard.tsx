import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { UserManagement } from "./admin-access.js";
import { CircuitBreakerCatalog, FeatureCatalog, GroupCatalog, HealthcheckCatalog, ScopeCatalog } from "./admin-catalogs.js";
import {
  CircuitBreakerDetail,
  FeatureDetail,
  GroupDetail,
  HealthcheckDetail,
  ScopeDetail,
  SubscriptionCatalog,
  SubscriptionDetail,
  TenantCatalog,
  TenantDetail,
  UserDetail,
} from "./admin-details.js";
import { AdminShell, ADMIN_SYSTEM_LINKS } from "./admin-shell.js";
import { JobDetail, JobList } from "./jobs.js";
import type { AdminLinkItem, AdminSelection, ApplicationAdminSection } from "./types.js";

export type AdminDashboardSection = "home" | "users" | "tenants" | "groups" | "scopes" | "subscriptions" | "jobs" | "features" | "healthchecks" | "circuit-breakers";
export const ADMIN_DASHBOARD_SECTIONS: readonly AdminDashboardSection[] = Object.freeze([
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
]);

const RENDERERS = new Map<string, () => ReactNode>(Object.entries({
  users: () => <UserManagement />,
  tenants: () => <TenantCatalog />,
  groups: () => <GroupCatalog />,
  scopes: () => <ScopeCatalog />,
  subscriptions: () => <SubscriptionCatalog />,
  jobs: () => <JobList />,
  features: () => <FeatureCatalog />,
  healthchecks: () => <HealthcheckCatalog />,
  "circuit-breakers": () => <CircuitBreakerCatalog />,
}));

const DETAILS = new Map<string, (id: string) => ReactNode>(Object.entries({
  users: (id: string) => <UserDetail userId={id} />,
  tenants: (id: string) => <TenantDetail tenantId={id} />,
  groups: (id: string) => <GroupDetail groupName={id} />,
  scopes: (id: string) => <ScopeDetail scopeName={id} />,
  subscriptions: (id: string) => <SubscriptionDetail subscriptionId={id} />,
  jobs: (id: string) => <JobDetail jobId={id} />,
  features: (id: string) => <FeatureDetail featureName={id} />,
  healthchecks: (id: string) => <HealthcheckDetail healthcheckId={id} />,
  "circuit-breakers": (id: string) => <CircuitBreakerDetail circuitId={id} />,
}));

export interface AdminDashboardProps {
  title?: string;
  initialSection?: string;
  enabledSections?: readonly string[];
  applicationSections?: readonly ApplicationAdminSection[];
  overview?: ReactNode;
  onSectionChange?: (selection: AdminSelection) => void;
}

/**
 * Complete client-side administration surface. Mount it on one protected page;
 * it owns section/detail navigation and does not require a site-side admin router.
 */
export function AdminDashboard({
  title = "Administration",
  initialSection = "home",
  enabledSections = ADMIN_DASHBOARD_SECTIONS,
  applicationSections = [],
  overview,
  onSectionChange,
}: AdminDashboardProps) {
  const enabled = useMemo(() => new Set(enabledSections), [enabledSections]);
  const builtInLinks = ADMIN_SYSTEM_LINKS.filter((link) => enabled.has(link.key));
  const customByKey = useMemo(() => new Map(applicationSections.map((section) => [section.key, section])), [applicationSections]);
  const fallback = enabled.has(initialSection) || customByKey.has(initialSection) ? initialSection : builtInLinks[0]?.key || applicationSections[0]?.key || "home";
  const [selection, setSelection] = useState<AdminSelection>({ key: fallback, id: null });

  const navigate = (key: string, id: string | null = null) => {
    if (!enabled.has(key) && !customByKey.has(key)) return;
    setSelection({ key, id });
    onSectionChange?.({ key, id });
  };

  const captureDetailLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = parseAdminHref(anchor.getAttribute("href"));
    if (!target || (!enabled.has(target.key) && !customByKey.has(target.key))) return;
    event.preventDefault();
    navigate(target.key, target.id);
  };

  const custom = customByKey.get(selection.key);
  const detail = selection.id ? DETAILS.get(selection.key) : undefined;
  const content = custom
    ? renderApplicationSection(custom, selection)
    : selection.key === "home"
      ? overview || <AdminOverview links={builtInLinks.filter((link) => link.key !== "home")} onNavigate={navigate} />
      : detail && selection.id
        ? detail(selection.id)
        : RENDERERS.get(selection.key)?.() || <p>Unknown administration section.</p>;

  return <AdminShell
    title={title}
    active={selection.key}
    systemLinks={builtInLinks}
    applicationLinks={applicationSections.map((section) => ({ key: section.key, label: section.label, href: section.href || `/admin/${section.key}` }))}
    onNavigate={(key) => navigate(key)}
  >
    <div onClick={captureDetailLink}>
      {selection.id ? <button className="cf-ui-back" type="button" onClick={() => navigate(selection.key)}>← Back to {labelFor(selection.key, builtInLinks, applicationSections)}</button> : null}
      {content}
    </div>
  </AdminShell>;
}

export interface AdminOverviewProps { links?: readonly AdminLinkItem[]; onNavigate?: (key: string) => void }
export function AdminOverview({ links = ADMIN_SYSTEM_LINKS.filter((link) => link.key !== "home"), onNavigate }: AdminOverviewProps) {
  return <section className="cf-ui-card"><header><h1>Administration</h1><p>Manage access, tenants, platform capabilities, and runtime operations.</p></header><div className="cf-ui-admin-grid">{links.map((link) => <a key={link.key} href={link.href} onClick={onNavigate ? (event) => { event.preventDefault(); onNavigate(link.key); } : undefined}><strong>{link.label}</strong><span>Open {link.label.toLowerCase()}</span></a>)}</div></section>;
}

function renderApplicationSection(section: ApplicationAdminSection, selection: AdminSelection): ReactNode {
  if (typeof section.render === "function") return section.render(selection);
  const Component = section.component;
  return Component ? <Component selection={selection} /> : null;
}

function parseAdminHref(href: string | null): AdminSelection | null {
  if (!href || !href.startsWith("/admin/")) return null;
  const [key, ...rest] = href.slice("/admin/".length).split("/").filter(Boolean);
  if (!key) return { key: "home", id: null };
  return { key, id: rest.length ? decodeURIComponent(rest.join("/")) : null };
}

function labelFor(key: string, builtInLinks: readonly AdminLinkItem[], applicationSections: readonly ApplicationAdminSection[]): string {
  return builtInLinks.find((link) => link.key === key)?.label
    || applicationSections.find((section) => section.key === key)?.label
    || key;
}
