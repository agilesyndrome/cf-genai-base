import { readFileSync } from "node:fs";
import { executeJson, parseJsonRows } from "./d1.js";
import type { CliJsonRow, CliOptions, CliTarget } from "./types.js";

export interface SiteDetails { name: string; url: string | null; config: string }
export interface SiteStatusGroup { total: number; green: number; attention: CliJsonRow[]; yellow?: number; red?: number; off?: number; tripped?: number }
export interface SiteStatus { site: SiteDetails; environment: CliTarget; database: string; healthchecks: SiteStatusGroup; circuit_breakers: SiteStatusGroup }

function readConfig(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/,\s*([}])/g, "$1")); }
  catch (error: unknown) { throw new Error(`Unable to read Wrangler config ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

function siteDetails(options: CliOptions): SiteDetails {
  const config = objectValue(readConfig(options.config));
  const routes = Array.isArray(config.routes) ? config.routes.filter(isObject) : [];
  const route = routes.find((item) => Boolean(item.custom_domain && item.pattern)) || routes.find((item) => Boolean(item.pattern));
  const vars = isObject(config.vars) ? config.vars : {};
  const pattern = route?.pattern;
  const routeUrl = typeof pattern === "string" ? (pattern.startsWith("http") ? pattern : `https://${pattern}`) : null;
  const origin = typeof vars.PUBLIC_ORIGIN === "string" ? vars.PUBLIC_ORIGIN : null;
  return { name: typeof config.name === "string" ? config.name : "Unnamed site", url: process.env.CF_GENAI_PRODUCTION_URL || origin || routeUrl, config: options.config };
}

function query(options: CliOptions, target: CliTarget, sql: string): CliJsonRow[] { return parseJsonRows(executeJson(options.wranglerCommand, options.database, target, sql, { ...options, target })); }

export function siteStatus(options: CliOptions): SiteStatus {
  const target = statusTarget(options.target);
  const checks = query(options, target, "SELECT id,display_name,feature,component,state FROM core_healthchecks ORDER BY feature,component;");
  const breakers = query(options, target, "SELECT id,display_name,feature,name,state FROM core_circuit_breakers ORDER BY feature,name;");
  const overview: SiteStatus = {
    site: siteDetails(options), environment: target, database: options.database,
    healthchecks: { total: checks.length, green: countState(checks, "green"), yellow: countState(checks, "yellow"), red: countState(checks, "red"), attention: checks.filter((item) => item.state !== "green") },
    circuit_breakers: { total: breakers.length, green: countState(breakers, "on"), off: countState(breakers, "off"), tripped: countState(breakers, "tripped"), attention: breakers.filter((item) => item.state !== "on") },
  };
  if (options.json) { console.log(JSON.stringify(overview, null, 2)); return overview; }
  console.log(`Site: ${overview.site.name}`);
  console.log(`URL: ${overview.site.url || "unknown"}`);
  console.log(`Environment: ${overview.environment}`);
  console.log(`Health checks: ${overview.healthchecks.green} green, ${overview.healthchecks.yellow} yellow, ${overview.healthchecks.red} red`);
  console.log(`Circuit breakers: ${overview.circuit_breakers.green} green, ${overview.circuit_breakers.off} off, ${overview.circuit_breakers.tripped} tripped`);
  const attention = [...overview.healthchecks.attention.map((item) => ({ type: "health check", item })), ...overview.circuit_breakers.attention.map((item) => ({ type: "circuit breaker", item }))];
  if (attention.length) { console.log("Attention:"); for (const entry of attention) console.log(`- ${entry.type}: ${String(entry.item.display_name || entry.item.id)} (${String(entry.item.state)})`); } else console.log("All systems green.");
  return overview;
}

function statusTarget(value: string): CliTarget { if (value === "staging" || value === "production") return value; return "production"; }
function countState(rows: readonly CliJsonRow[], state: string): number { return rows.filter((item) => item.state === state).length; }
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function objectValue(value: unknown): Record<string, unknown> { return isObject(value) ? value : {}; }
