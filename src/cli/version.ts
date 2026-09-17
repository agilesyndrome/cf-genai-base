import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const PACKAGE_NAME = "@agilesyndrome/cf-genai-base";

export function localVersion(): string {
  const packageUrl = new URL("../../package.json", import.meta.url);
  const metadata: unknown = JSON.parse(readFileSync(packageUrl, "utf8"));
  const version = metadata !== null && typeof metadata === "object" ? Reflect.get(metadata, "version") : null;
  if (typeof version !== "string") throw new Error("package.json does not contain a valid version.");
  return version;
}

export function latestVersion(packageName = PACKAGE_NAME): string | null {
  const result = spawnSync("npm", ["view", packageName, "version"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

interface ParsedVersion { numbers: [number, number, number]; prerelease: string[] }

function parsedVersion(value: string): ParsedVersion | null {
  const match = String(value).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parsedVersion(left);
  const b = parsedVersion(right);
  if (!a || !b) return String(left).localeCompare(String(right));
  for (let index = 0; index < 3; index += 1) {
    const leftNumber = a.numbers[index] ?? 0;
    const rightNumber = b.numbers[index] ?? 0;
    if (leftNumber !== rightNumber) return leftNumber - rightNumber;
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) return 1;
  if (a.prerelease.length > 0 && b.prerelease.length === 0) return -1;
  return String(a.prerelease).localeCompare(String(b.prerelease), undefined, { numeric: true });
}

export interface VersionOutputInput { local: string; latest: string | null; packageName?: string }

export function formatVersionOutput({ local, latest, packageName = PACKAGE_NAME }: VersionOutputInput): string {
  const lines = [`${packageName} local: ${local}`, `${packageName} latest: ${latest ?? "unavailable"}`];
  if (latest && compareVersions(latest, local) > 0) {
    lines.push("Upgrade available:", `  npm i -g ${packageName}`);
  }
  return lines.join("\n");
}

export function runVersionCommand(): void {
  const local = localVersion();
  const latest = latestVersion();
  console.log(formatVersionOutput({ local, latest }));
}
