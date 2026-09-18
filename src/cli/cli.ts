import { backupD1, checkConfig, checkD1, migrateD1, refreshLocalD1, refreshStagingD1, restoreD1, statusD1 } from "./d1.js";
import { runUserCommand } from "./users.js";
import { runTenantCommand } from "./tenants.js";
import { runOperationalCommand } from "./operations.js";
import { runProjectCommand, type ProjectCommandResult } from "./project.js";
import { siteStatus, type SiteStatus } from "./status.js";
import type { CliOptions, CliTarget } from "./types.js";
import { runVersionCommand } from "./version.js";

export const usage = `Usage:
  cf-genai check|test|build|ci|ci:lint
  cf-genai lint data-access
  cf-genai dev [options]
  cf-genai upgrade <base|auth> <latest|VERSION>
  cf-genai release [--confirm] [--first] [--add-trust] [--pre] [--dry-run] [--bypass-lint] [--type patch|minor|major] [--version MAJOR.MINOR]
  cf-genai release-status [--wait MINUTES] [--json]
    cf-genai status [--env local|staging|production] [--json]
  cf-genai version
  cf-genai d1 refresh|backup|restore|migrate|status|check local|staging|production [options]
  cf-genai admin status|features|users|tenants|scopes|groups|healthchecks|circuit-breakers [options]
  cf-genai config check [options]
  cf-genai user list|get|update [username] [options]
  cf-genai tenant list|get|create|update [tenant-id] [options]

Options:
  --database NAME             D1 binding or database name (default: DB)
  --production-database NAME  Production D1 binding or database name
  --production-env NAME       Wrangler production environment (default: none)
  --staging-env NAME          Wrangler staging environment (default: staging)
  --config PATH               Wrangler config path (default: wrangler.jsonc)
  --env VALUE                 Environment: local, staging, or production
  --output PATH               Backup output file
  --file PATH                 Restore input file
  --wrangler COMMAND          Wrangler command (default: npx wrangler)
  --yes                       Confirm a remote staging refresh
  --confirm-production        Explicitly permit production migration or breaker changes
  --confirm                    Confirm a destructive or release operation
  --dry-run                    Show release checks without changing Git or npm
  --pre                        Publish or refresh the current patch prerelease as <version>-pre
  --version MAJOR.MINOR        Explicit release target; patch is assigned as .0
  --bypass-lint                Skip the release preflight lint (use sparingly)
  --json                      Return machine-readable output
  --help                      Show this help
`;

function splitCommand(value = "npx wrangler"): string[] {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^(["'])(.*)\1$/, "$2")) ?? ["npx", "wrangler"];
}

export function parseOptions(args: readonly string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  const options: CliOptions = {
    config: env.CF_GENAI_WRANGLER_CONFIG || "wrangler.jsonc",
    database: env.CF_GENAI_DATABASE || "DB",
    productionDatabase: "",
    productionEnv: env.CF_GENAI_PRODUCTION_ENV || "",
    stagingEnv: env.CF_GENAI_STAGING_ENV || "staging",
    wranglerCommand: splitCommand(env.CF_GENAI_WRANGLER || "npx wrangler"),
    yes: false,
    confirmProduction: false,
    target: env.CF_GENAI_TARGET || "local",
    json: false,
    help: false,
    positional: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") { options.help = true; return options; }
    if (arg === "--yes") options.yes = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--confirm-production") options.confirmProduction = true;
    else if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=", 2);
      const value = inline ?? args[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}.`);
      switch (key) {
        case "database": options.database = value; break;
        case "production-database": options.productionDatabase = value; break;
        case "production-env": options.productionEnv = value; break;
        case "staging-env": options.stagingEnv = value; break;
        case "config": options.config = value; break;
        case "wrangler": options.wranglerCommand = splitCommand(value); break;
        case "target": case "env": options.target = value; break;
        case "roles": options.roles = value; break;
        case "scopes": options.scopes = value; break;
        case "groups": options.groups = value; break;
        case "tenants": options.tenants = value; break;
        case "name": options.name = value; break;
        case "output": options.output = value; break;
        case "file": options.file = value; break;
        default: throw new Error(`Unknown option: ${arg}`);
      }
    } else options.positional.push(arg);
  }
  if (!options.productionDatabase) options.productionDatabase = options.database;
  return options;
}

export type CliCommandResult = Awaited<ProjectCommandResult> | SiteStatus | void;

export async function main(args: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<CliCommandResult> {
  if (args[0] === "version") return runVersionCommand();
  const projectCommand = args[0];
  if (projectCommand && ["check", "test", "build", "ci", "ci:lint", "lint", "dev", "upgrade", "release", "release-status"].includes(projectCommand)) {
    const result = runProjectCommand(projectCommand, args.slice(1));
    if (result === null) throw new Error(`Unknown command.\n\n${usage}`);
    return result;
  }
  const options = parseOptions(args, env);
  if (options.positional[0] === "status") return siteStatus(options);
  if (options.help || options.positional.length === 0) {
    console.log(usage);
    return undefined;
  }
  const [domain, action, target] = options.positional;
  if (domain === "admin") {
    const adminAction = action;
    if (isCliTarget(target)) options.target = target;
    if (adminAction === "tenants") return runTenantCommand({ action: options.positional[2] || "list", identifier: options.positional[3], name: options.name, options });
    if (adminAction && ["healthchecks", "circuit-breakers"].includes(adminAction)) return runOperationalCommand({ domain: adminAction, action: options.positional[2] || "list", identifier: options.positional[3], value: options.positional[4], options });
    return runOperationalCommand({ domain: "admin", action: adminAction, identifier: options.positional[3], value: options.positional[4], options });
  }
  if (domain === "user") return runUserCommand({ action, username: target, options });
  if (domain === "tenant") return runTenantCommand({ action, identifier: target, name: options.name, options });
  if (domain && ["healthchecks", "circuit-breakers"].includes(domain)) return runOperationalCommand({ domain, action, identifier: target, value: options.positional[3], options });
  if (domain === "config" && action === "check") return checkConfig(options);
  if (domain !== "d1" || !action || !["refresh", "backup", "restore", "migrate", "status", "check"].includes(action)) throw new Error(`Unknown command.\n\n${usage}`);
  if (!isCliTarget(target)) throw new Error("Target must be local, staging, or production.");
  if (action === "backup" || action === "restore") return runD1FileCommand(action, target, options);
  if (action === "refresh") {
    if (target === "staging" && !options.yes) throw new Error("Staging refresh replaces remote data; rerun with --yes.");
    if (target === "local") return refreshLocalD1({ database: options.database, productionDatabase: options.productionDatabase, target, options });
    if (target === "staging") return refreshStagingD1({ database: options.database, productionDatabase: options.productionDatabase, target, options });
    throw new Error(`Unknown command.\n\n${usage}`);
  }
  if (action === "migrate" && target === "production" && !options.confirmProduction) throw new Error("Production migration requires --confirm-production.");
  if (action === "migrate") return migrateD1({ target, database: options.database, options });
  if (action === "status") return statusD1({ target, database: options.database, options });
  return checkD1({ target, database: options.database, options });
}

function runD1FileCommand(action: "backup" | "restore", target: CliTarget, options: CliOptions): void | Promise<void> {
  const input = { target, database: options.database, options };
  return action === "backup" ? backupD1(input) : restoreD1(input);
}

function isCliTarget(value: string | undefined): value is CliTarget {
  return value === "local" || value === "staging" || value === "production";
}

export type { CliOptions, CliTarget } from "./types.js";
