#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Keep this JavaScript launcher as the npm bin compatibility boundary. Published
// packages load compiled TypeScript output; source checkouts run the TypeScript
// entrypoint through the development dependency installed by npm ci/install.
const builtEntrypoint = new URL("../dist/cli/cli.js", import.meta.url);
const sourceEntrypoint = new URL("../src/cli/cli.ts", import.meta.url);

if (!existsSync(builtEntrypoint)) {
  const sourceRunner = new URL("../scripts/run-cli.mjs", import.meta.url);
  const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(sourceRunner), ...process.argv.slice(2)], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} else {
  const { main } = await import(builtEntrypoint.href);

  try {
    const result = await main(process.argv.slice(2));
    if (result?.ok === false) process.exitCode = 1;
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
