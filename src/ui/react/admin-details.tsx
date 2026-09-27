import { apiJson } from "../../api/client.js";
import { ResourceState, StatusBadge, useApiResource } from "./foundation.js";
import type { ReactNode } from "react";
import { useState, type FormEvent } from "react";
import type { ApiResource } from "./foundation.js";
import { recordArrayField, recordField, type UiRecord } from "./types.js";

interface DetailProps { resource: Pick<ApiResource, "loading" | "error">; value: UiRecord | null; empty: string; children: (value: UiRecord) => ReactNode }
function Detail({ resource, value, empty, children }: DetailProps) {
  return <section className="cf-ui-card"><ResourceState {...resource} empty={empty}>{value ? children(value) : null}</ResourceState></section>;
}

function DefinitionList({ entries }: { entries: readonly (readonly [string, unknown])[] }) {
  return <dl className="cf-ui-detail-list">{entries.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>;
}

export function UserDetail({ userId }: { userId: string }) {
  const resource = useApiResource(`/api/admin/users/${encodeURIComponent(userId)}`, { enabled: Boolean(userId) });
  const user = recordField(resource.value, "user");
  return <Detail resource={resource} value={user} empty="User not found.">{(item) => { const direct = (item.scopes || []).map((scope) => typeof scope === "string" ? scope : scope.scope_name || scope.name || ""); const inherited = (item.groups || []).flatMap((group) => (group.scopes || []).map((scope) => `${scope} (${group.display_name || group.group_name || group.name})`)); return <><header><h1>{item.display_name || item.email || "Unnamed user"}</h1><p>{item.email}</p></header><DefinitionList entries={[["ID", item.id], ["Provider", item.provider], ["Status", item.active === false || item.active === 0 ? "Inactive" : "Active"], ["Administrator", Boolean(item.is_admin)]]} /><Relation title="Tenants" values={(item.tenants || []).map((tenant) => tenant.name || tenant.id || "")} /><Relation title="Groups" values={(item.groups || []).map((group) => group.group_name || group.name || "")} /><section><h2>User Allowed To</h2><CheckScopeList values={direct} /><h2>Inherited Permissions</h2><CheckScopeList values={inherited} /><h2>User Can Not</h2><CheckScopeList values={[]} empty="No denied scopes are registered." /></section></>; }}</Detail>;
}

export function TenantCatalog() {
  const resource = useApiResource("/api/admin/tenants");
  const tenants = recordArrayField(resource.value, "tenants");
  const [name, setName] = useState("");
  const create = async (event: FormEvent) => { event.preventDefault(); if (!name.trim()) return; await apiJson("/api/admin/tenants", { id: name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-"), name: name.trim() }, { method: "POST" }); setName(""); await resource.reload(); };
  return <section className="cf-ui-card"><header><h1>Tenants</h1><p>Create, edit, delete, and inspect tenant membership.</p></header><form className="cf-ui-filter-bar" onSubmit={create}><input aria-label="New tenant name" placeholder="New tenant name" value={name} onChange={(event) => setName(event.target.value)} /><button type="submit">Add tenant</button></form><ResourceState {...resource} empty="No tenants registered.">{tenants.length ? <ul className="cf-ui-list">{tenants.map((tenant) => <li className="cf-ui-list-row" key={tenant.id}><a href={`/admin/tenants/${encodeURIComponent(tenant.id || "")}`}><strong>{tenant.name}</strong></a><small>{tenant.id} · {tenant.user_count || 0} users · {tenant.active === false || tenant.active === 0 ? "Inactive" : "Active"}</small></li>)}</ul> : null}</ResourceState></section>;
}

export function TenantDetail({ tenantId }: { tenantId: string }) {
  const resource = useApiResource(`/api/admin/tenants/${encodeURIComponent(tenantId)}`, { enabled: Boolean(tenantId) });
  const users = useApiResource(`/api/admin/tenants/${encodeURIComponent(tenantId)}/users`, { enabled: Boolean(tenantId) });
  const tenant = recordField(resource.value, "tenant");
  const save = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); await apiJson(`/api/admin/tenants/${encodeURIComponent(tenantId)}`, { name: String(form.get("name") || "") }, { method: "PUT" }); await resource.reload(); };
  const remove = async () => { if (!confirm(`Delete tenant ${tenantId}?`)) return; await apiJson(`/api/admin/tenants/${encodeURIComponent(tenantId)}`, {}, { method: "DELETE", headers: { "X-Confirm-Delete": tenantId } }); window.history.back(); };
  return <Detail resource={{ ...resource, loading: resource.loading || users.loading, error: resource.error || users.error }} value={tenant} empty="Tenant not found.">{(item) => <><header><h1>{item.name}</h1><p>{item.id}</p></header><form className="cf-ui-filter-bar" onSubmit={save}><input name="name" aria-label="Tenant name" defaultValue={item.name} /><button type="submit">Save tenant</button><button type="button" onClick={() => void remove()}>Delete tenant</button></form><DefinitionList entries={[["Users", item.user_count || 0], ["Created", item.created_at], ["Updated", item.updated_at]]} /><Relation title="Members" values={recordArrayField(users.value, "users").map((user) => user.display_name || user.email || user.id || "")} /></>}</Detail>;
}

export function GroupDetail({ groupName }: { groupName: string }) {
  const encoded = encodeURIComponent(groupName);
  const group = useApiResource(`/api/admin/groups/${encoded}`, { enabled: Boolean(groupName) });
  const users = useApiResource(`/api/admin/groups/${encoded}/users`, { enabled: Boolean(groupName) });
  const item = recordField(group.value, "group");
  return <Detail resource={{ ...group, error: group.error || users.error, loading: group.loading || users.loading }} value={item} empty="Group not found.">{(value) => <><header><h1>{value.display_name}</h1><p>{value.description}</p></header><DefinitionList entries={[["Name", value.name], ["Created", value.created_at], ["Updated", value.updated_at]]} /><Relation title="Members" values={recordArrayField(users.value, "users").map((user) => user.display_name || user.email || user.id || "")} /></>}</Detail>;
}

export function ScopeDetail({ scopeName }: { scopeName: string }) {
  const resource = useApiResource(`/api/admin/scopes/${encodeURIComponent(scopeName)}`, { enabled: Boolean(scopeName) });
  const scope = recordField(resource.value, "scope");
  return <Detail resource={resource} value={scope} empty="Scope not found.">{(item) => <><h1>{item.label || item.name}</h1><p>{item.description}</p><DefinitionList entries={[["Name", item.name], ["System scope", Boolean(item.system)]]} /></>}</Detail>;
}

export function FeatureDetail({ featureName }: { featureName: string }) {
  const resource = useApiResource("/api/admin/features", { enabled: Boolean(featureName) });
  const feature = recordArrayField(resource.value, "features").find((item) => item.feature === featureName) || null;
  return <Detail resource={resource} value={feature} empty="Feature not found.">{(item) => <><header className="cf-ui-feature-heading"><div className={`cf-ui-health-icon cf-ui-status-${item.health}`}>●</div><div><h1>{item.display_name || item.feature}</h1><p>{item.feature} · {item.package_name || "Unknown package"} {item.version || ""}</p></div></header><DefinitionList entries={[["Health roll-up", item.health], ["Circuit roll-up", item.circuit_breaker?.state || "None"]]} /><section><h2>Health checks</h2><div className="cf-ui-list">{(item.healthchecks || []).map((entry) => <article className="cf-ui-breaker" key={entry.id}><span className={`cf-ui-health-icon cf-ui-status-${entry.state}`}>●</span><span><strong>{entry.display_name}</strong><small>{entry.component}</small></span><StatusBadge state={entry.state} /></article>)}</div></section><section><h2>Circuit breakers</h2><div className="cf-ui-list">{(item.circuit_breakers || []).map((entry) => <article className="cf-ui-breaker" key={entry.id}><span><strong>{entry.display_name}</strong><small>{entry.name}</small></span><StatusBadge state={entry.state} /><span>{metadataReason(entry.metadata) || "State is derived from health and dependency evaluation."}</span></article>)}</div></section></>}</Detail>;
}

export function HealthcheckDetail({ healthcheckId }: { healthcheckId: string }) {
  const resource = useApiResource(`/api/admin/healthchecks/${encodeURIComponent(healthcheckId)}`, { enabled: Boolean(healthcheckId) });
  const item = recordField(resource.value, "healthcheck");
  return <Detail resource={resource} value={item} empty="Healthcheck not found.">{(value) => <><h1>{value.display_name}</h1><StatusBadge state={value.state} /><DefinitionList entries={[["Feature", value.feature], ["Component", value.component], ["Updated", value.updated_at]]} /></>}</Detail>;
}

export function CircuitBreakerDetail({ circuitId }: { circuitId: string }) {
  const path = `/api/admin/circuit-breakers/${encodeURIComponent(circuitId)}`;
  const resource = useApiResource(path, { enabled: Boolean(circuitId) });
  const item = recordField(resource.value, "circuit_breaker");
  const update = async (state: string) => { await apiJson(path, { state }, { method: "PUT" }); await resource.reload(); };
  return <Detail resource={resource} value={item} empty="Circuit breaker not found.">{(value) => <><h1>{value.display_name}</h1><StatusBadge state={value.state} /><DefinitionList entries={[["Feature", value.feature], ["Name", value.name], ["Healthcheck mode", value.healthcheck_mode], ["Self-healing", Boolean(value.allow_self_healing)], ["Why", metadataReason(value.metadata) || "No transition reason recorded."]]} /><div className="cf-ui-actions"><select aria-label="Set circuit breaker state" value={value.state || "off"} onChange={(event) => void update(event.target.value)}><option value="off">Off</option><option value="on">On</option>{value.state === "tripped" ? <option value="tripped">Tripped</option> : null}</select></div></>}</Detail>;
}

export function SubscriptionCatalog() {
  const resource = useApiResource("/api/admin/subscriptions");
  const items = recordArrayField(resource.value, "subscriptions");
  return <section className="cf-ui-card"><h1>Subscriptions</h1><ResourceState {...resource} empty="No subscriptions registered.">{items.length ? <ul className="cf-ui-list">{items.map((item) => <li key={item.id}><a href={`/admin/subscriptions/${encodeURIComponent(item.id || "")}`}><strong>{item.name}</strong></a><small>{item.id}</small></li>)}</ul> : null}</ResourceState></section>;
}

export function SubscriptionDetail({ subscriptionId }: { subscriptionId: string }) {
  const resource = useApiResource(`/api/admin/subscriptions/${encodeURIComponent(subscriptionId)}`, { enabled: Boolean(subscriptionId) });
  const item = recordField(resource.value, "subscription");
  return <Detail resource={resource} value={item} empty="Subscription not found.">{(value) => <><h1>{value.name}</h1><DefinitionList entries={[["ID", value.id], ["Updated", value.updated_at]]} /><Relation title="Entitlements" values={(value.entitlements || []).map((entry) => `${entry.entitlement}: ${JSON.stringify(entry.value)}`)} /></>}</Detail>;
}

function Relation({ title, values }: { title: string; values: readonly string[] }) {
  return <section><h2>{title}</h2>{values.length ? <ul>{values.map((value) => <li key={value}>{value}</li>)}</ul> : <p>None</p>}</section>;
}

function CheckScopeList({ values, empty = "None" }: { values: readonly string[]; empty?: string }) {
  return values.length ? <ul className="cf-ui-scope-list">{values.map((value) => <li key={value}><label><input type="checkbox" checked readOnly />{value}</label></li>)}</ul> : <p>{empty}</p>;
}

function metadataReason(value: unknown): string | null {
  return value && typeof value === "object" && !Array.isArray(value) && typeof Reflect.get(value, "reason") === "string" ? String(Reflect.get(value, "reason")) : null;
}
