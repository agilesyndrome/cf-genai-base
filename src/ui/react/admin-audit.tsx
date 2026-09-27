import { useState } from "react";
import { ResourceState, useApiResource } from "./foundation.js";
import { recordArrayField } from "./types.js";

export function AuditLogCatalog() {
  const [filters, setFilters] = useState({ who: "", resource: "", operation: "" });
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
  query.set("limit", "100");
  const resource = useApiResource(`/api/admin/audit-log?${query.toString()}`);
  const entries = recordArrayField(resource.value, "audit");
  return <section className="cf-ui-card"><header><h1>Audit log</h1><p>Administrative changes from the last 30 days.</p></header><form className="cf-ui-filter-bar" onSubmit={(event) => { event.preventDefault(); void resource.reload(); }}><input aria-label="Filter by actor" placeholder="Who" value={filters.who} onChange={(event) => setFilters({ ...filters, who: event.target.value })} /><input aria-label="Filter by resource" placeholder="What" value={filters.resource} onChange={(event) => setFilters({ ...filters, resource: event.target.value })} /><input aria-label="Filter by operation" placeholder="Operation" value={filters.operation} onChange={(event) => setFilters({ ...filters, operation: event.target.value })} /><button type="submit">Filter</button></form><ResourceState {...resource} empty="No audit entries in the last 30 days.">{entries.length ? <div className="cf-ui-table-wrap"><table><thead><tr><th>Date</th><th>Who</th><th>Operation</th><th>Resource</th><th>Details</th></tr></thead><tbody>{entries.map((entry, index) => <tr key={entry.id || index}><td>{entry.created_at}</td><td>{entry.who}</td><td>{entry.operation}</td><td>{entry.resource}</td><td><code>{JSON.stringify(entry.details || {})}</code></td></tr>)}</tbody></table></div> : null}</ResourceState></section>;
}
