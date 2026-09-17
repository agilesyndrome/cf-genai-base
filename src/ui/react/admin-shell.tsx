import type { MouseEvent, ReactNode } from "react";
import type { AdminLinkItem } from "./types.js";

export const ADMIN_SYSTEM_LINKS: readonly AdminLinkItem[] = Object.freeze([
  { label: "Overview", href: "/admin", key: "home" },
  { label: "Users", href: "/admin/users", key: "users" },
  { label: "Tenants", href: "/admin/tenants", key: "tenants" },
  { label: "User groups", href: "/admin/groups", key: "groups" },
  { label: "Scopes", href: "/admin/scopes", key: "scopes" },
  { label: "Subscriptions", href: "/admin/subscriptions", key: "subscriptions" },
  { label: "Jobs", href: "/admin/jobs", key: "jobs" },
  { label: "Features", href: "/admin/features", key: "features" },
  { label: "Health checks", href: "/admin/healthchecks", key: "healthchecks" },
  { label: "Circuit breakers", href: "/admin/circuit-breakers", key: "circuit-breakers" },
]);

export interface AdminShellProps { children?: ReactNode; active?: string; applicationLinks?: readonly AdminLinkItem[]; systemLinks?: readonly AdminLinkItem[]; title?: string; onNavigate?: (key: string, link?: AdminLinkItem) => void }
export function AdminShell({ children, active = "", applicationLinks = [], systemLinks = ADMIN_SYSTEM_LINKS, title = "Administration", onNavigate }: AdminShellProps) {
  return <div className="cf-ui-admin-shell"><aside className="cf-ui-admin-nav"><p className="cf-ui-admin-title">{title}</p><nav aria-label="Administration">{applicationLinks.length ? <section><p className="cf-ui-nav-label">Application</p>{applicationLinks.map((link) => <AdminLink key={link.key || link.href} link={link} active={active} onNavigate={onNavigate} />)}</section> : null}<section><p className="cf-ui-nav-label">System</p>{systemLinks.map((link) => <AdminLink key={link.key || link.href} link={link} active={active} onNavigate={onNavigate} />)}</section></nav></aside><main className="cf-ui-admin-content">{children}</main></div>;
}

export interface AdminLinkProps { link: AdminLinkItem; active: string; onNavigate?: (key: string, link?: AdminLinkItem) => void }
export function AdminLink({ link, active, onNavigate }: AdminLinkProps) {
  const select = onNavigate ? (event: MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onNavigate(link.key, link); } : undefined;
  return <a href={link.href} aria-current={link.key === active ? "page" : undefined} onClick={select}>{link.label}</a>;
}
