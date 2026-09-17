import type { NewAuthGroup } from "./model.js";

const GROUP_NAME = /^[a-z0-9][a-z0-9._:-]*$/;

export function validateGroupName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!GROUP_NAME.test(name)) throw new TypeError("Group names must use lowercase capability-style characters.");
  return name;
}

export function validateGroupInput(value: unknown): NewAuthGroup {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("A group object is required.");
  const input = value as Record<string, unknown>;
  const name = validateGroupName(input.name);
  const display_name = typeof input.display_name === "string" ? input.display_name.trim() : "";
  if (!display_name) throw new TypeError("display_name is required.");
  const description = input.description === undefined ? "" : String(input.description).trim();
  return { name, display_name, description };
}

export function validateGroupNames(values: readonly unknown[]): string[] {
  return [...new Set(values.map(validateGroupName))];
}
