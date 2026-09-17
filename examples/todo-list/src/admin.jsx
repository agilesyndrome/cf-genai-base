import { AdminDashboard } from "../../../src/ui/react/index.js";

// Mount this component at /admin from the site's React entry point.
export function TodoAdmin() {
  return <AdminDashboard title="Todo administration" enabledSections={["home", "users", "tenants", "groups", "scopes", "jobs", "features", "healthchecks", "circuit-breakers"]} />;
}
