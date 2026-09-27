import { executeJson, parseJsonRows } from "./d1.js";
import type { CliJsonRow, CliOptions, CliTarget } from "./types.js";

export interface UserCommandInput { action?: string; username?: string; options: CliOptions }

function sql(value: unknown): string { return `'${String(value).replaceAll("'", "''")}'`; }
function query(database: string, target: CliTarget, command: string, options: CliOptions): CliJsonRow[] { return parseJsonRows(executeJson(options.wranglerCommand, database, target, command, options)); }
function csv(value: string): string[] { return value.split(",").map((item) => item.trim()).filter(Boolean); }

export function runUserCommand({ action, username, options }: UserCommandInput): void {
  const target = targetValue(options.target);
  if (action === "list") {
    const users = query(options.database, target, "SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM auth_users ORDER BY email COLLATE NOCASE;", options);
    console.log(JSON.stringify(users.map((user) => ({ ...user, tenants: query(options.database, target, "SELECT t.id,t.name FROM auth_tenants t JOIN auth_user_tenants ut ON ut.tenant_id=t.id WHERE ut.user_id=" + sql(user.id) + " ORDER BY t.name COLLATE NOCASE;", options) })), null, 2));
    return;
  }
  if (!username) throw new Error("A username, email, subject, or user id is required.");
  const where = `(id=${sql(username)} OR email=${sql(username)} OR subject=${sql(username)})`;
  const rows = query(options.database, target, `SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM auth_users WHERE ${where} LIMIT 1;`, options);
  const user = rows[0];
  if (!user) throw new Error(`User not found: ${username}`);
  if (action === "get") {
    const scopes = query(options.database, target, `SELECT scope_name,granted_at FROM auth_user_scopes WHERE user_id=${sql(user.id)} ORDER BY scope_name;`, options);
    const groups = query(options.database, target, `SELECT group_name,granted_at FROM auth_user_groups WHERE user_id=${sql(user.id)} ORDER BY group_name;`, options);
    const tenants = query(options.database, target, `SELECT t.id,t.name,ut.joined_at FROM auth_tenants t JOIN auth_user_tenants ut ON ut.tenant_id=t.id WHERE ut.user_id=${sql(user.id)} ORDER BY t.name COLLATE NOCASE;`, options);
    console.log(JSON.stringify({ ...user, scopes, groups, tenants }, null, 2));
    return;
  }
  if (action !== "update") throw new Error("Unknown user action.");
  const assignments: string[] = [];
  if (options.roles !== undefined) assignments.push(`is_admin=${csv(options.roles).includes("admin") ? 1 : 0}`);
  if (!assignments.length && options.scopes === undefined && options.groups === undefined && options.tenants === undefined) throw new Error("user:update requires --roles, --scopes, --groups, or --tenants.");
  const scopes = options.scopes === undefined ? undefined : csv(options.scopes);
  const groups = options.groups === undefined ? undefined : csv(options.groups);
  const tenants = options.tenants === undefined ? undefined : csv(options.tenants);
  validateAssignment(options.database, target, "auth_scopes", "name", scopes, options, true);
  validateAssignment(options.database, target, "auth_groups", "name", groups, options);
  validateAssignment(options.database, target, "auth_tenants", "id", tenants, options);
  const statements = ["BEGIN;"];
  if (assignments.length) statements.push(`UPDATE auth_users SET ${assignments.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=${sql(user.id)};`);
  appendAssignmentSql(statements, scopes, "auth_user_scopes", "scope_name", user.id);
  appendAssignmentSql(statements, groups, "auth_user_groups", "group_name", user.id);
  if (tenants !== undefined) {
    statements.push(`DELETE FROM auth_user_tenants WHERE user_id=${sql(user.id)};`);
    for (const tenant of tenants) statements.push(`INSERT INTO auth_user_tenants (user_id,tenant_id) VALUES (${sql(user.id)},${sql(tenant)});`);
  }
  statements.push("COMMIT;");
  executeJson(options.wranglerCommand, options.database, target, statements.join("\n"), options);
  runUserCommand({ action: "get", username: String(user.id), options });
}

function validateAssignment(database: string, target: CliTarget, table: "auth_scopes" | "auth_groups" | "auth_tenants", column: "name" | "id", values: string[] | undefined, options: CliOptions, rejectProtected = false): void {
  if (!values?.length) return;
  const rows = query(database, target, `SELECT ${column},${rejectProtected ? "system" : ""} FROM ${table} WHERE ${column} IN (${values.map(sql).join(",")});`.replace(`, FROM`, " FROM"), options);
  if (rows.length !== new Set(values).size) throw new Error(`One or more ${table.replace("auth_", "")} do not exist.`);
  if (rejectProtected && rows.some((row) => Boolean(row.system))) throw new Error("System scopes cannot be assigned directly.");
}

function appendAssignmentSql(statements: string[], values: string[] | undefined, table: "auth_user_scopes" | "auth_user_groups", column: "scope_name" | "group_name", userId: unknown): void {
  if (values === undefined) return;
  statements.push(`DELETE FROM ${table} WHERE user_id=${sql(userId)};`);
  for (const item of values) statements.push(`INSERT INTO ${table} (user_id,${column},granted_by) VALUES (${sql(userId)},${sql(item)},'human:cli');`);
}

function targetValue(value: string): CliTarget {
  if (value === "local" || value === "staging" || value === "production") return value;
  throw new Error("User target must be local, staging, or production.");
}
