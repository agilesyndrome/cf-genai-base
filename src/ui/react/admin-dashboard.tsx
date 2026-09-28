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
import { AuditLogCatalog } from "./admin-audit.js";
import type { AdminLinkItem, AdminSelection, ApplicationAdminSection } from "./types.js";
import { useApiResource } from "./foundation.js";
import { recordField } from "./types.js";

export type AdminDashboardSection = "home" | "users" | "tenants" | "groups" | "scopes" | "subscriptions" | "jobs" | "features" | "audit-log" | "healthchecks" | "circuit-breakers";
export const ADMIN_DASHBOARD_SECTIONS: readonly AdminDashboardSection[] = Object.freeze([
  "home",
  "users",
  "tenants",
  "groups",
  "scopes",
  "subscriptions",
  "jobs",
  "features",
  "audit-log",
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
  "audit-log": () => <AuditLogCatalog />,
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
  applicationRegistration?: ApplicationRegistration;
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
  applicationRegistration,
  onSectionChange,
}: AdminDashboardProps) {
  const enabled = useMemo(() => new Set(enabledSections), [enabledSections]);
  const builtInLinks = ADMIN_SYSTEM_LINKS.filter((link) => enabled.has(link.key));
  const customByKey = useMemo(() => new Map(applicationSections.map((section) => [section.key, section])), [applicationSections]);
  const fallback = enabled.has(initialSection) || customByKey.has(initialSection) ? initialSection : builtInLinks[0]?.key || applicationSections[0]?.key || "home";
  const [selection, setSelection] = useState<AdminSelection>({ key: fallback, id: null });

  const navigate = (key: string, id: string | null = null) => {
    if (key !== "audit-log" && !enabled.has(key) && !customByKey.has(key)) return;
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
      ? overview || <AdminOverview registration={applicationRegistration} />
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

export interface ApplicationRegistration { name?: string; version?: string; registeredFeatures?: readonly { name?: string; displayName?: string; packageName?: string; version?: string }[]; domains?: readonly string[]; readOnlyDomains?: readonly string[] }
export interface AdminOverviewProps { registration?: ApplicationRegistration; links?: readonly AdminLinkItem[]; onNavigate?: (key: string) => void }
export function AdminOverview({ registration }: AdminOverviewProps) {
  const resource = useApiResource("/api/admin/registration");
  const serverRegistration = recordField(resource.value, "registration");
  const current = registration || readApplicationRegistration(serverRegistration);
  const features = current?.registeredFeatures || [];
  return <section className="cf-ui-card"><header><h1>{current?.name || "Application administration"}</h1><p>Application registration and runtime capabilities.</p></header><dl className="cf-ui-detail-list"><div><dt>App name</dt><dd>{current?.name || "Not supplied"}</dd></div><div><dt>Version</dt><dd>{current?.version || "Not supplied"}</dd></div><div><dt>Writable domains</dt><dd>{current?.domains?.join(", ") || "None"}</dd></div><div><dt>Read-only domains</dt><dd>{current?.readOnlyDomains?.join(", ") || "None"}</dd></div></dl><section><h2>Registered features</h2>{features.length ? <ul className="cf-ui-list">{features.map((feature, index) => <li className="cf-ui-list-row" key={feature.name || index}><strong>{feature.displayName || feature.name}</strong><small>{feature.packageName || "Unknown package"} · {feature.version || "Unknown version"}</small></li>)}</ul> : <p>No application features registered.</p>}</section></section>;
}

function readApplicationRegistration(value: ReturnType<typeof recordField>): ApplicationRegistration | undefined {
  if (!value) return undefined;
  const features = Array.isArray(value.registeredFeatures)
    ? value.registeredFeatures.filter(isApplicationFeature)
    : undefined;
  const domains = Array.isArray(value.domains)
    ? value.domains.filter((domain): domain is string => typeof domain === "string")
    : undefined;
  const readOnlyDomains = Array.isArray(value.readOnlyDomains)
    ? value.readOnlyDomains.filter((domain): domain is string => typeof domain === "string")
    : undefined;
  return {
    name: typeof value.name === "string" ? value.name : undefined,
    version: typeof value.version === "string" ? value.version : undefined,
    registeredFeatures: features,
    domains,
    readOnlyDomains,
  };
}

function isApplicationFeature(value: unknown): value is NonNullable<ApplicationRegistration["registeredFeatures"]>[number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const feature = value as Record<string, unknown>;
  return ["name", "displayName", "packageName", "version"].every((key) =>
    feature[key] === undefined || typeof feature[key] === "string"
  );
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
