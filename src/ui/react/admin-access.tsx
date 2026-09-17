import { useState, type Dispatch, type SetStateAction } from "react";
import { apiJson } from "../../api/client.js";
import { ResourceState, useApiResource } from "./foundation.js";
import { recordArrayField, type UiRecord } from "./types.js";

export function UserManagement() {
  const users = useApiResource("/api/admin/users");
  const scopes = useApiResource("/api/admin/scopes");
  const tenants = useApiResource("/api/admin/tenants");
  const groups = useApiResource("/api/admin/groups");
  const reload = () => Promise.all([users.reload(), scopes.reload(), tenants.reload(), groups.reload()]);
  const options = { scopes: recordArrayField(scopes.value, "scopes"), tenants: recordArrayField(tenants.value, "tenants"), groups: recordArrayField(groups.value, "groups") };
  const userItems = recordArrayField(users.value, "users");
  return <section className="cf-ui-card"><h1>User access</h1><ResourceState loading={users.loading || scopes.loading || tenants.loading || groups.loading} error={users.error || scopes.error || tenants.error || groups.error} empty="No users registered.">{userItems.length ? <div className="cf-ui-table-wrap"><table><thead><tr><th>User</th><th>Tenants</th><th>Groups</th><th>Scopes</th><th>Save</th></tr></thead><tbody>{userItems.map((user) => <UserRow key={user.id} user={user} options={options} onSaved={reload} />)}</tbody></table></div> : null}</ResourceState></section>;
}

interface AccessOptions { scopes: UiRecord[]; tenants: UiRecord[]; groups: UiRecord[] }
interface UserRowProps { user: UiRecord; options: AccessOptions; onSaved: () => Promise<unknown> }

function UserRow({ user, options, onSaved }: UserRowProps) {
  const [selectedScopes, setSelectedScopes] = useStateSet((user.scopes || []).filter((scope): scope is string => typeof scope === "string"));
  const [selectedTenants, setSelectedTenants] = useStateSet((user.tenants || []).map((tenant) => tenant.id).filter((id): id is string => typeof id === "string"));
  const [selectedGroups, setSelectedGroups] = useStateSet((user.groups || []).map((group) => group.group_name || group.name).filter((name): name is string => typeof name === "string"));
  const [saving, setSaving] = useState(false);
  const save = async () => { if (!user.id) return; setSaving(true); try { await apiJson(`/api/admin/users/${encodeURIComponent(user.id)}/access`, { scopes: [...selectedScopes], tenants: [...selectedTenants], groups: [...selectedGroups] }, { method: "PUT" }); await onSaved(); } finally { setSaving(false); } };
  return <tr><th scope="row"><a href={`/admin/users/${encodeURIComponent(user.id || "")}`}>{user.display_name || user.email || "Unnamed user"}</a><small>{user.email || "No email"}</small></th><td><CheckList items={options.tenants} selected={selectedTenants} onChange={setSelectedTenants} valueKey="id" labelKey="name" /></td><td><CheckList items={options.groups} selected={selectedGroups} onChange={setSelectedGroups} valueKey="name" labelKey="display_name" /></td><td><CheckList items={options.scopes} selected={selectedScopes} onChange={setSelectedScopes} valueKey="name" labelKey="label" /></td><td><button type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button></td></tr>;
}

type ChecklistKey = "id" | "name" | "display_name" | "label";
interface CheckListProps { items: readonly UiRecord[]; selected: Set<string>; onChange: Dispatch<SetStateAction<Set<string>>>; valueKey: ChecklistKey; labelKey: ChecklistKey }
function CheckList({ items, selected, onChange, valueKey, labelKey }: CheckListProps) {
  return <div className="cf-ui-check-list">{items.map((item, index) => { const value = item[valueKey]; if (typeof value !== "string") return null; const label = item[labelKey]; return <label key={`${value}:${index}`}><input type="checkbox" checked={selected.has(value)} onChange={(event) => { const next = new Set(selected); if (event.target.checked) next.add(value); else next.delete(value); onChange(next); }} />{typeof label === "string" ? label : value}</label>; })}</div>;
}

function useStateSet(initial: readonly string[] = []): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [value, setValue] = useState<Set<string>>(() => new Set(initial));
  return [value, setValue];
}
