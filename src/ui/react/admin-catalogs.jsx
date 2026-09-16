import { apiJson } from "../../api/client.js";
import { useLiveEvent } from "./live-events.jsx";
import { ResourceState, StatusBadge, useApiResource, useMutation } from "./foundation.jsx";

export function FeatureCatalog() {
  const resource = useApiResource("/api/admin/features");
  useLiveEvent((event) => ["healthcheck", "circuit"].some((word) => String(event.what || "").includes(word)), resource.reload);
  const features = resource.value?.features || [];
  return <section className="cf-ui-card"><header><h1>Installed features</h1><p>Runtime modules, package versions, healthchecks, and circuit breakers.</p></header><ResourceState {...resource} empty="No features registered.">{features.length ? <div className="cf-ui-table-wrap"><table><thead><tr><th>Feature</th><th>Package/version</th><th>Health</th><th>Roll-up</th><th>Healthchecks</th><th>Breakers</th></tr></thead><tbody>{features.map((item) => <tr key={item.feature}><th scope="row">{item.display_name || item.feature}<small>{item.feature}</small></th><td>{item.package_name || "Unknown package"}<br />{item.version || "Unknown version"}</td><td><StatusBadge state={item.health} /></td><td>{item.circuit_breaker ? <StatusBadge state={item.circuit_breaker.state} /> : "None"}</td><td><CatalogList items={item.healthchecks} /></td><td><CatalogList items={item.circuit_breakers} /></td></tr>)}</tbody></table></div> : null}</ResourceState></section>;
}

export function HealthcheckCatalog() {
  const resource = useApiResource("/api/admin/healthchecks");
  const items = resource.value?.healthchecks || [];
  return <section className="cf-ui-card"><h1>Healthchecks</h1><ResourceState {...resource} empty="No healthchecks registered.">{items.length ? <div className="cf-ui-card-grid">{items.map((item) => <article className="cf-ui-card" key={item.id}><h2>{item.display_name}</h2><StatusBadge state={item.state} /><p>{item.feature} / {item.component}</p></article>)}</div> : null}</ResourceState></section>;
}

export function CircuitBreakerCatalog() {
  const resource = useApiResource("/api/admin/circuit-breakers");
  const items = resource.value?.circuit_breakers || [];
  const update = async (item, state) => { await apiJson(`/api/admin/circuit-breakers/${encodeURIComponent(item.id)}`, { state }, { method: "PUT" }); await resource.reload(); };
  return <section className="cf-ui-card"><h1>Circuit breakers</h1><ResourceState {...resource} empty="No circuit breakers registered.">{items.length ? <div className="cf-ui-list">{items.map((item) => <article className="cf-ui-breaker" key={item.id}><div><h2>{item.display_name}</h2><small>{item.feature}/{item.name}</small></div><StatusBadge state={item.state} /><div className="cf-ui-actions">{["off", "tripped", "on"].map((state) => <button type="button" key={state} disabled={item.state === state} onClick={() => update(item, state)}>{state}</button>)}</div></article>)}</div> : null}</ResourceState></section>;
}

export function ScopeCatalog() {
  const resource = useApiResource("/api/admin/scopes");
  const scopes = resource.value?.scopes || [];
  return <section className="cf-ui-card"><h1>Scopes</h1><ResourceState {...resource} empty="No scopes registered.">{scopes.length ? <ul className="cf-ui-list">{scopes.map((scope) => <li key={scope.name}><strong>{scope.label || scope.name}</strong><small>{scope.name}</small><p>{scope.description}</p></li>)}</ul> : null}</ResourceState></section>;
}

export function GroupCatalog() {
  const resource = useApiResource("/api/admin/groups");
  const groups = resource.value?.groups || [];
  return <section className="cf-ui-card"><h1>Groups</h1><ResourceState {...resource} empty="No groups registered.">{groups.length ? <ul className="cf-ui-list">{groups.map((group) => <li key={group.id || group.name}><strong>{group.display_name || group.name}</strong><small>{group.name}</small></li>)}</ul> : null}</ResourceState></section>;
}

function CatalogList({ items = [] }) {
  return items.length ? <ul className="cf-ui-inline-list">{items.map((item) => <li key={item.id || item.name}><strong>{item.display_name || item.name}</strong>: <StatusBadge state={item.state} /></li>)}</ul> : <span>None registered</span>;
}
