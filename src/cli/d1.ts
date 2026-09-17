import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliJsonRow, CliOptions, CliTarget, D1CommandInput, D1RefreshInput } from "./types.js";

export const INTERNAL_TABLE_SQL = `
SELECT name
FROM sqlite_schema
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
  AND name NOT LIKE '_cf_%'
  AND name <> 'd1_migrations'
ORDER BY name;
`;

export interface D1RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  capture?: boolean;
}

export function shellCommand(value = "npx wrangler"): string[] {
  return value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((part) => part.replace(/^(["'])(.*)\1$/, "$2")) ?? ["npx", "wrangler"];
}

export function targetArgs(target: CliTarget, options: Pick<CliOptions, "stagingEnv" | "productionEnv"> | Partial<Pick<CliOptions, "stagingEnv" | "productionEnv">> = {}): string[] {
  if (target === "local") return ["--local"];
  const args = ["--remote"];
  const environment = target === "staging" ? options.stagingEnv : options.productionEnv;
  if (environment) args.push("--env", environment);
  return args;
}

export function extractRows(value: unknown): CliJsonRow[] {
  if (Array.isArray(value)) return value.flatMap(extractRows);
  if (value === null || typeof value !== "object") return [];
  const rows: CliJsonRow[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (key === "results" && Array.isArray(child)) {
      rows.push(...child.filter(isJsonRow));
    }
    rows.push(...extractRows(child));
  }
  return rows;
}

export function parseJsonRows(output: string): CliJsonRow[] {
  try {
    const value: unknown = JSON.parse(output);
    return extractRows(value);
  } catch {
    throw new Error("Wrangler returned invalid JSON while inspecting D1.");
  }
}

export function tableNamesFromJson(output: string): string[] {
  return parseJsonRows(output)
    .map((row) => row.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}

export function clearSql(tableNames: readonly string[]): string {
  const identifiers = tableNames.map((name) => `"${name.replaceAll('"', '""')}"`);
  return [
    "PRAGMA defer_foreign_keys = ON;",
    ...identifiers.map((name) => `DELETE FROM ${name};`),
    "PRAGMA defer_foreign_keys = OFF;",
    "",
  ].join("\n");
}

export function stripInternalRows(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^\s*INSERT\s+INTO\s+["`]?((d1_migrations)|(sqlite_[^"`\s]*)|(_cf_[^"`\s]*))["`]?/i.test(line))
    .join("\n");
}

function run(wrangler: readonly string[], args: readonly string[], options: D1RunOptions = {}): string {
  const executable = wrangler[0];
  if (!executable) throw new Error("Wrangler command is empty.");
  const result = spawnSync(executable, [...wrangler.slice(1), ...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${wrangler.join(" ")} exited with status ${result.status ?? "unknown"}.`);
  return result.stdout ?? "";
}

function execute(wrangler: readonly string[], database: string, target: CliTarget, sqlFile: string, options: CliOptions): void {
  run(wrangler, ["d1", "execute", database, ...targetArgs(target, options), "--file", sqlFile, "--yes", "--config", options.config], options);
}

export function executeJson(wrangler: readonly string[], database: string, target: CliTarget, command: string, options: CliOptions): string {
  return run(wrangler, ["d1", "execute", database, ...targetArgs(target, options), "--command", command, "--json", "--config", options.config], { ...options, capture: true });
}

function migrations(wrangler: readonly string[], database: string, target: CliTarget, options: CliOptions): void {
  run(wrangler, ["d1", "migrations", "apply", database, ...targetArgs(target, options), "--config", options.config], options);
}

async function refreshD1(target: Extract<CliTarget, "local" | "staging">, { database, productionDatabase, options }: D1RefreshInput): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "cf-genai-d1-refresh-"));
  const exportPath = join(directory, "production-data.sql");
  const importPath = join(directory, "application-data.sql");
  try {
    run(options.wranglerCommand, [
      "d1", "export", productionDatabase, "--remote",
      ...(options.productionEnv ? ["--env", options.productionEnv] : []),
      "--no-schema", "--output", exportPath, "--skip-confirmation", "--config", options.config,
    ], options);
    migrations(options.wranglerCommand, database, target, options);
    const tables = tableNamesFromJson(executeJson(options.wranglerCommand, database, target, INTERNAL_TABLE_SQL, options));
    if (tables.length === 0) throw new Error(`No application tables found in ${target} D1 database.`);
    const exported = await readFile(exportPath, "utf8");
    await writeFile(importPath, `${clearSql(tables)}${stripInternalRows(exported)}`);
    execute(options.wranglerCommand, database, target, importPath, options);
    const projectDirectory = options.cwd || process.cwd();
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(join(projectDirectory, ".cf-genai-last-prod-refresh"), `${new Date().toISOString()}\n`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function refreshLocalD1(args: D1RefreshInput): Promise<void> {
  return refreshD1("local", args);
}

export function refreshStagingD1(args: D1RefreshInput): Promise<void> {
  return refreshD1("staging", args);
}

export function migrateD1({ target, database, options }: D1CommandInput): void {
  migrations(options.wranglerCommand, database, target, options);
}

export function statusD1({ target, database, options }: D1CommandInput): void {
  if (target !== "local") {
    run(options.wranglerCommand, ["d1", "info", database, ...(target === "staging" && options.stagingEnv ? ["--env", options.stagingEnv] : []), ...(target === "production" && options.productionEnv ? ["--env", options.productionEnv] : []), "--config", options.config], options);
    return;
  }
  console.log(executeJson(options.wranglerCommand, database, target, "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'index') ORDER BY type, name;", options));
}

export function checkD1({ target, database, options }: D1CommandInput): void {
  const rows = parseJsonRows(executeJson(options.wranglerCommand, database, target, "PRAGMA foreign_key_check; PRAGMA integrity_check;", options));
  const failures = rows.filter((row) => {
    const values = Object.values(row);
    return !(values.length === 1 && values[0] === "ok");
  });
  if (failures.length > 0) throw new Error(`D1 integrity checks failed: ${JSON.stringify(failures)}`);
  console.log(`${target} D1 integrity checks passed.`);
}

export function backupD1({ target, database, options }: D1CommandInput): void {
  if (!options.output) throw new Error("Backup requires --output PATH.");
  if (target === "production" && !options.confirmProduction) throw new Error("Production backup requires --confirm-production.");
  run(options.wranglerCommand, ["d1", "export", database, ...targetArgs(target, options), "--output", options.output, "--skip-confirmation", "--config", options.config], options);
  console.log(`Backed up ${database} (${target}) to ${options.output}`);
}

export async function restoreD1({ target, database, options }: D1CommandInput): Promise<void> {
  if (!options.file) throw new Error("Restore requires --file PATH.");
  try { await readFile(options.file); } catch { throw new Error(`Restore file not found: ${options.file}`); }
  if (target !== "local" && !options.yes) throw new Error("Remote restore replaces data; rerun with --yes.");
  if (target === "production" && !options.confirmProduction) throw new Error("Production restore requires --confirm-production.");
  execute(options.wranglerCommand, database, target, options.file, options);
  console.log(`Restored ${database} (${target}) from ${options.file}`);
}

export function checkConfig(options: CliOptions): void {
  run(options.wranglerCommand, ["deploy", "--dry-run", "--config", options.config], options);
}

function isJsonRow(value: unknown): value is CliJsonRow {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
