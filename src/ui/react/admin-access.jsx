import { useState } from "react";
import { apiJson } from "../../api/client.js";
import { ResourceState, useApiResource } from "./foundation.jsx";

export function UserManagement() {
  const users = useApiResource("/api/admin/users");
  const scopes = useApiResource("/api/admin/scopes");
  const tenants = useApiResource("/api/admin/tenants");
  const reload = () => Promise.all([users.reload(), scopes.reload(), tenants.reload()]);
  const options = { scopes: scopes.value?.scopes || [], tenants: tenants.value?.tenants || [] };
  return <section className="cf-ui-card"><h1>User access</h1><ResourceState loading={users.loading || scopes.loading || tenants.loading} error={users.error || scopes.error || tenants.error} empty="No users registered.">{(users.value?.users || []).length ? <div className="cf-ui-table-wrap"><table><thead><tr><th>User</th><th>Tenants</th><th>Scopes</th><th>Save</th></tr></thead><tbody>{users.value.users.map((user) => <UserRow key={user.id} user={user} options={options} onSaved={reload} />)}</tbody></table></div> : null}</ResourceState></section>;
}

function UserRow({ user, options, onSaved }) {
  const [selectedScopes, setSelectedScopes] = useStateSet(user.scopes);
  const [selectedTenants, setSelectedTenants] = useStateSet((user.tenants || []).map((tenant) => tenant.id));
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await Promise.all([apiJson(`/api/admin/users/${encodeURIComponent(user.id)}/scopes`, { scopes: [...selectedScopes] }, { method: "PUT" }), apiJson(`/api/admin/users/${encodeURIComponent(user.id)}/tenants`, { tenants: [...selectedTenants] }, { method: "PUT" })]); await onSaved(); } finally { setSaving(false); } };
  return <tr><th scope="row">{user.display_name || user.email || "Unnamed user"}<small>{user.email || "No email"}</small></th><td><CheckList items={options.tenants} selected={selectedTenants} onChange={setSelectedTenants} valueKey="id" labelKey="name" /></td><td><CheckList items={options.scopes} selected={selectedScopes} onChange={setSelectedScopes} valueKey="name" labelKey="label" /></td><td><button type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></td></tr>;
}

function CheckList({ items, selected, onChange, valueKey, labelKey }) {
  return <div className="cf-ui-check-list">{items.map((item) => { const value = item[valueKey]; return <label key={value}><input type="checkbox" checked={selected.has(value)} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(value); else next.delete(value); onChange(next); }} />{item[labelKey] || value}</label>; })}</div>;
}

function useStateSet(initial = []) {
  const [value, setValue] = useState(() => new Set(initial || []));
  return [value, setValue];
}
