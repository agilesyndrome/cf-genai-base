import { requestActor } from "../identity/index.js";
import { canManageGroups } from "./policy.js";
import { deleteGroupRow, getGroupRow, insertGroupRow, listGroupRows, listGroupUsersRows, listUserGroupsRows, replaceUserGroupsRows, updateGroupRow } from "./d1.js";
import { validateGroupInput, validateGroupName, validateGroupNames } from "./validation.js";
import type { GroupAuthorizationState, AuthGroup, GroupUser } from "./model.js";

export interface GroupServiceOptions {
  who?: string;
}

export async function listGroups(env: unknown, options: GroupServiceOptions = {}): Promise<AuthGroup[]> {
  return listGroupRows(env, options);
}

export async function getGroup(env: unknown, name: unknown, options: GroupServiceOptions = {}): Promise<AuthGroup | null> {
  return getGroupRow(env, validateGroupName(name), options);
}

export async function createGroup(env: unknown, input: unknown, options: GroupServiceOptions = {}): Promise<AuthGroup | null> {
  return insertGroupRow(env, validateGroupInput(input), options);
}

export async function updateGroup(env: unknown, name: unknown, input: unknown, options: GroupServiceOptions = {}): Promise<AuthGroup | null> {
  const validated = validateGroupInput({ ...(input as Record<string, unknown>), name });
  return updateGroupRow(env, validated.name, validated, options);
}

export async function deleteGroup(env: unknown, name: unknown, options: GroupServiceOptions = {}): Promise<boolean> {
  return deleteGroupRow(env, validateGroupName(name), options);
}

export async function listGroupUsers(env: unknown, name: unknown, options: GroupServiceOptions = {}): Promise<GroupUser[]> {
  return listGroupUsersRows(env, validateGroupName(name), options);
}

export async function listUserGroups(env: unknown, userId: string, options: GroupServiceOptions = {}) {
  return listUserGroupsRows(env, userId, options);
}

export async function replaceUserGroups(env: unknown, userId: string, groups: readonly unknown[], grantedBy?: string, options: GroupServiceOptions = {}) {
  return replaceUserGroupsRows(env, userId, validateGroupNames(groups), grantedBy, options);
}

export function assertGroupAdministrator(state: GroupAuthorizationState): void {
  if (!canManageGroups(state)) throw new Error("Administrator access is required.");
}

export function groupActor(state: GroupAuthorizationState): string {
  return requestActor(state);
}
