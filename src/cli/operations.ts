import { executeJson, parseJsonRows } from "./d1.js";
import type { CliJsonRow, CliOptions, CliTarget, OperationalCommandInput } from "./types.js";

function query(command: string, options: CliOptions & { target: CliTarget }): CliJsonRow[] {
  return parseJsonRows(executeJson(options.wranglerCommand, options.database, options.target, command, options));
}

function output(value: unknown): void { console.log(JSON.stringify(value, null, 2)); }

export function runOperationalCommand({ domain, action, identifier, value, options }: OperationalCommandInput): void {
  const target = normalizeTarget(options.target);
  const scoped = { ...options, target };
  if (domain === "admin" && action === "status") return output(query("SELECT feature,MAX(CASE state WHEN 'red' THEN 2 WHEN 'yellow' THEN 1 ELSE 0 END) AS severity,COUNT(*) AS healthchecks FROM core_healthchecks GROUP BY feature ORDER BY feature;", scoped));
  if (domain === "admin" && action === "features") return output(query("SELECT feature,COUNT(*) AS healthchecks FROM core_healthchecks GROUP BY feature ORDER BY feature;", scoped));
  if (domain === "admin" && action === "users") return output(query("SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM auth_users ORDER BY email COLLATE NOCASE;", scoped));
  if (domain === "admin" && action === "scopes") return output(query("SELECT name,label,description,system FROM auth_scopes ORDER BY name;", scoped));
  if (domain === "admin" && action === "groups") return output(query("SELECT name,display_name,description,created_at,updated_at FROM auth_groups ORDER BY display_name COLLATE NOCASE;", scoped));
  if (domain === "healthchecks" && action === "list") return output(query("SELECT id,feature,component,display_name,state,metadata_json,created_at,updated_at FROM core_healthchecks ORDER BY feature,component;", scoped));
  if (domain === "healthchecks" && action === "get") { if (!identifier) throw new Error("A healthcheck id is required."); return output(query("SELECT id,feature,component,display_name,state,metadata_json,created_at,updated_at FROM core_healthchecks WHERE id=" + sql(identifier) + " LIMIT 1;", scoped)); }
  if (domain === "healthchecks" && action === "set") { if (!identifier || !value) throw new Error("healthchecks set requires an id and state (red, yellow, or green)."); if (!["red", "yellow", "green"].includes(value)) throw new Error("Healthcheck state must be red, yellow, or green."); query("UPDATE core_healthchecks SET state=" + sql(value) + ",updated_at=CURRENT_TIMESTAMP WHERE id=" + sql(identifier) + ";", scoped); return output({ id: identifier, state: value, environment: target, changed_by: "human:cli" }); }
  if (domain === "circuit-breakers" && action === "list") return output(query("SELECT id,feature,name,display_name,state,healthcheck_mode,allow_self_healing,metadata_json,created_at,updated_at FROM core_circuit_breakers ORDER BY feature,name;", scoped));
  if (domain === "circuit-breakers" && action === "get") { if (!identifier) throw new Error("A circuit-breaker id is required."); return output(query("SELECT id,feature,name,display_name,state,healthcheck_mode,allow_self_healing,metadata_json,created_at,updated_at FROM core_circuit_breakers WHERE id=" + sql(identifier) + " LIMIT 1;", scoped)); }
  if (domain === "circuit-breakers" && action === "set") {
    if (!identifier || !value) throw new Error("circuit-breakers set requires an id and state (off, tripped, or on).");
    if (!["off", "tripped", "on"].includes(value)) throw new Error("Circuit-breaker state must be off, tripped, or on.");
    if (target === "production" && !options.confirmProduction) throw new Error("Production circuit-breaker changes require --confirm-production.");
    if (!query("SELECT id,state FROM core_circuit_breakers WHERE id=" + sql(identifier) + " LIMIT 1;", scoped)[0]) throw new Error("Circuit breaker not found: " + identifier);
    query("UPDATE core_circuit_breakers SET state=" + sql(value) + ",updated_at=CURRENT_TIMESTAMP WHERE id=" + sql(identifier) + ";", scoped);
    return output({ id: identifier, state: value, environment: target, changed_by: "human:cli" });
  }
  throw new Error("Unknown operational command.");
}

function normalizeTarget(target: string): CliTarget {
  if (target === "local" || target === "staging" || target === "production") return target;
  if (!target) return "local";
  throw new Error("Environment must be local, staging, or production.");
}

function sql(value: unknown): string { return `'${String(value).replaceAll("'", "''")}'`; }
