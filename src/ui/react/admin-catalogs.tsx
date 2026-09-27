import { apiJson } from "../../api/client.js";
import { useLiveEvent } from "./live-events.js";
import { ResourceState, StatusBadge, useApiResource, useMutation } from "./foundation.js";
import { recordArrayField, type UiRecord } from "./types.js";

export function FeatureCatalog() {
  const resource = useApiResource("/api/admin/features");
  useLiveEvent((event) => ["healthcheck", "circuit"].some((word) => String(event.what || "").includes(word)), resource.reload);
  const features = recordArrayField(resource.value, "features");
  return <section className="cf-ui-card"><header><h1>Features</h1><p>Application-registered capabilities. Open a feature to inspect health checks and circuit-breaker diagnostics.</p></header><ResourceState {...resource} empty="No features registered.">{features.length ? <div className="cf-ui-list">{features.map((item) => <article className="cf-ui-feature-row" key={item.feature}><div className={`cf-ui-health-icon cf-ui-status-${item.health}`} aria-label={`${item.health} health`} title={`${item.health} health`}>●</div><div><h2><a href={`/admin/features/${encodeURIComponent(item.feature || "")}`}>{item.display_name || item.feature}</a></h2><small>{item.feature} · {item.package_name || "Unknown package"} {item.version || ""}</small></div><div><small>Health</small><StatusBadge state={item.health} /></div><div><small>Circuit</small>{item.circuit_breaker ? <StatusBadge state={item.circuit_breaker.state} /> : "None"}</div><div><small>{item.healthchecks?.length || 0} checks · {item.circuit_breakers?.length || 0} breakers</small></div></article>)}</div> : null}</ResourceState></section>;
}

export function HealthcheckCatalog() {
  const resource = useApiResource("/api/admin/healthchecks");
  const items = recordArrayField(resource.value, "healthchecks");
  return <section className="cf-ui-card"><h1>Healthchecks</h1><ResourceState {...resource} empty="No healthchecks registered.">{items.length ? <div className="cf-ui-card-grid">{items.map((item) => <article className="cf-ui-card" key={item.id}><h2><a href={`/admin/healthchecks/${encodeURIComponent(item.id || "")}`}>{item.display_name}</a></h2><StatusBadge state={item.state} /><p>{item.feature} / {item.component}</p></article>)}</div> : null}</ResourceState></section>;
}

export function CircuitBreakerCatalog() {
  const resource = useApiResource("/api/admin/circuit-breakers");
  const items = recordArrayField(resource.value, "circuit_breakers");
  const update = async (item: UiRecord, state: string) => { if (!item.id) return; await apiJson(`/api/admin/circuit-breakers/${encodeURIComponent(item.id)}`, { state }, { method: "PUT" }); await resource.reload(); };
  return <section className="cf-ui-card"><h1>Circuit breakers</h1><p>Automation owns the tripped state. Administrators may only choose On or Off.</p><ResourceState {...resource} empty="No circuit breakers registered.">{items.length ? <div className="cf-ui-list">{items.map((item) => <article className="cf-ui-breaker" key={item.id}><div><h2><a href={`/admin/circuit-breakers/${encodeURIComponent(item.id || "")}`}>{item.display_name}</a></h2><small>{item.feature}/{item.name}</small></div><StatusBadge state={item.state} /><select aria-label={`Set ${item.display_name} state`} value={item.state || "off"} onChange={(event) => void update(item, event.target.value)}><option value="off">Off</option><option value="on">On</option>{item.state === "tripped" ? <option value="tripped">Tripped</option> : null}</select></article>)}</div> : null}</ResourceState></section>;
}

export function ScopeCatalog() {
  const resource = useApiResource("/api/admin/scopes");
  const scopes = recordArrayField(resource.value, "scopes");
  return <section className="cf-ui-card"><h1>Scopes</h1><ResourceState {...resource} empty="No scopes registered.">{scopes.length ? <ul className="cf-ui-list">{scopes.map((scope) => <li key={scope.name}><a href={`/admin/scopes/${encodeURIComponent(scope.name || "")}`}><strong>{scope.label || scope.name}</strong></a><small>{scope.name}</small><p>{scope.description}</p></li>)}</ul> : null}</ResourceState></section>;
}

export function GroupCatalog() {
  const resource = useApiResource("/api/admin/groups");
  const groups = recordArrayField(resource.value, "groups");
  return <section className="cf-ui-card"><h1>Groups</h1><ResourceState {...resource} empty="No groups registered.">{groups.length ? <ul className="cf-ui-list">{groups.map((group) => <li key={group.id || group.name}><a href={`/admin/groups/${encodeURIComponent(group.name || "")}`}><strong>{group.display_name || group.name}</strong></a><small>{group.name}</small></li>)}</ul> : null}</ResourceState></section>;
}

function CatalogList({ items = [] }: { items?: readonly UiRecord[] }) {
  return items.length ? <ul className="cf-ui-inline-list">{items.map((item, index) => <li key={item.id || item.name || index}><strong>{item.display_name || item.name}</strong>: <StatusBadge state={item.state} /></li>)}</ul> : <span>None registered</span>;
}
