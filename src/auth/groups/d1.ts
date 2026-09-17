import { createD1 } from "../../core/database/index.js";
import type { AuthGroup, GroupUser, NewAuthGroup } from "./model.js";

export interface GroupDatabaseOptions {
  who?: string;
}

type Row = Record<string, unknown>;

export async function listGroupRows(env: unknown, { who = "system:read" }: GroupDatabaseOptions = {}): Promise<AuthGroup[]> {
  const result = await createD1(env, { who }).prepare("SELECT name,display_name,description,created_at,updated_at FROM auth_groups ORDER BY display_name COLLATE NOCASE").all() as { results?: AuthGroup[] };
  return result.results ?? [];
}

export async function getGroupRow(env: unknown, name: string, { who = "system:read" }: GroupDatabaseOptions = {}): Promise<AuthGroup | null> {
  return await createD1(env, { who }).prepare("SELECT name,display_name,description,created_at,updated_at FROM auth_groups WHERE name=?").bind(name).first() as AuthGroup | null;
}

export async function insertGroupRow(env: unknown, input: NewAuthGroup, { who = "system:update" }: GroupDatabaseOptions = {}): Promise<AuthGroup | null> {
  await createD1(env, { who }).prepare("INSERT INTO auth_groups (name,display_name,description) VALUES (?,?,?)").bind(input.name, input.display_name, input.description ?? "").run();
  return getGroupRow(env, input.name, { who });
}

export async function updateGroupRow(env: unknown, name: string, input: Omit<NewAuthGroup, "name">, { who = "system:update" }: GroupDatabaseOptions = {}): Promise<AuthGroup | null> {
  await createD1(env, { who }).prepare("UPDATE auth_groups SET display_name=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE name=?").bind(input.display_name, input.description ?? "", name).run();
  return getGroupRow(env, name, { who });
}

export async function deleteGroupRow(env: unknown, name: string, { who = "system:update" }: GroupDatabaseOptions = {}): Promise<boolean> {
  const existing = await getGroupRow(env, name, { who });
  if (!existing) return false;
  const db = createD1(env, { who });
  const membership = await db.prepare("SELECT 1 FROM auth_user_groups WHERE group_name=? LIMIT 1").bind(name).first();
  if (membership) throw new TypeError("Group must have no members before it can be deleted.");
  await db.prepare("DELETE FROM auth_groups WHERE name=?").bind(name).run();
  return true;
}

export async function listGroupUsersRows(env: unknown, groupName: string, { who = "system:read" }: GroupDatabaseOptions = {}): Promise<GroupUser[]> {
  const result = await createD1(env, { who }).prepare("SELECT u.id,u.email,u.display_name,ug.granted_at FROM auth_user_groups ug JOIN auth_users u ON u.id=ug.user_id WHERE ug.group_name=? ORDER BY u.display_name COLLATE NOCASE,u.email").bind(groupName).all() as { results?: GroupUser[] };
  return result.results ?? [];
}

export async function listUserGroupsRows(env: unknown, userId: string, { who = "system:read" }: GroupDatabaseOptions = {}): Promise<Row[]> {
  const result = await createD1(env, { who }).prepare("SELECT group_name,granted_at FROM auth_user_groups WHERE user_id=? ORDER BY group_name").bind(userId).all() as { results?: Row[] };
  return result.results ?? [];
}

export async function replaceUserGroupsRows(env: unknown, userId: string, groups: readonly string[], grantedBy: string | undefined, { who = "system:update" }: GroupDatabaseOptions = {}): Promise<Row[]> {
  const db = createD1(env, { who });
  await db.batch([
    db.prepare("DELETE FROM auth_user_groups WHERE user_id=?").bind(userId),
    ...[...new Set(groups)].map((group) => db.prepare("INSERT INTO auth_user_groups (user_id,group_name,granted_by) VALUES (?,?,?)").bind(userId, group, grantedBy ?? null)),
  ]);
  return listUserGroupsRows(env, userId, { who });
}
