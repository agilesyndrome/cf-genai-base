import { executeJson, parseJsonRows } from "./d1.js";
import type { CliJsonRow, CliOptions, CliTarget } from "./types.js";

export interface TenantCommandInput { action?: string; identifier?: string; name?: string; options: CliOptions }

function sql(value: unknown): string { return `'${String(value).replaceAll("'", "''")}'`; }
function query(database: string, target: CliTarget, command: string, options: CliOptions): CliJsonRow[] { return parseJsonRows(executeJson(options.wranglerCommand, database, target, command, options)); }
function output(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

export function runTenantCommand({ action, identifier, name, options }: TenantCommandInput): void {
  const target = targetValue(options.target, "Tenant");
  if (action === "list") return output(query(options.database, target, "SELECT t.id,t.name,t.created_at,t.updated_at,COUNT(ut.user_id) AS user_count FROM auth_tenants t LEFT JOIN auth_user_tenants ut ON ut.tenant_id=t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE;", options));
  if (!identifier) throw new Error("A tenant id is required.");
  if (action === "get") return output(query(options.database, target, "SELECT id,name,created_at,updated_at FROM auth_tenants WHERE id=" + sql(identifier) + " LIMIT 1;", options));
  if (action === "create") { if (!name) throw new Error("tenant:create requires --name."); query(options.database, target, "INSERT INTO auth_tenants (id,name) VALUES (" + sql(identifier) + "," + sql(name) + ");", options); return output({ id: identifier, name, environment: target, changed_by: "human:cli" }); }
  if (action === "update") { if (!name) throw new Error("tenant update requires --name."); query(options.database, target, "UPDATE auth_tenants SET name=" + sql(name) + ",updated_at=CURRENT_TIMESTAMP WHERE id=" + sql(identifier) + ";", options); return output({ id: identifier, name, environment: target, changed_by: "human:cli" }); }
  throw new Error("Unknown tenant action.");
}

function targetValue(value: string, subject: string): CliTarget {
  if (value === "local" || value === "staging" || value === "production") return value;
  throw new Error(`${subject} target must be local, staging, or production.`);
}
