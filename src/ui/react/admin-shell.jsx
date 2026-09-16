const SYSTEM_LINKS = [
  ["Overview", "/admin", "home"],
  ["Users", "/admin/users", "users"],
  ["Scopes", "/admin/scopes", "scopes"],
  ["Groups", "/admin/groups", "groups"],
  ["Features", "/admin/features", "features"],
  ["Healthchecks", "/admin/healthchecks", "healthchecks"],
  ["Circuit breakers", "/admin/circuit-breakers", "circuit-breakers"],
];

export function AdminShell({ children, active = "", applicationLinks = [], title = "Administration" }) {
  return <div className="cf-ui-admin-shell"><aside className="cf-ui-admin-nav"><p className="cf-ui-admin-title">{title}</p><nav aria-label="Administration"><section><p className="cf-ui-nav-label">Application</p>{applicationLinks.map((link) => <AdminLink key={link.href} link={link} active={active} />)}</section><section><p className="cf-ui-nav-label">System</p>{SYSTEM_LINKS.map(([label, href, key]) => <AdminLink key={href} link={{ label, href, key }} active={active} />)}</section></nav></aside><main className="cf-ui-admin-content">{children}</main></div>;
}

export function AdminLink({ link, active }) {
  return <a href={link.href} aria-current={link.key === active ? "page" : undefined}>{link.label}</a>;
}
