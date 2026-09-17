#!/usr/bin/env node

import { existsSync } from "node:fs";

// Keep this JavaScript launcher as the npm bin compatibility boundary. Published
// packages load compiled TypeScript output; source checkouts can run it via tsx.
const builtEntrypoint = new URL("../dist/cli/cli.js", import.meta.url);
const sourceEntrypoint = new URL("../src/cli/cli.js", import.meta.url);
const { main } = await import(existsSync(builtEntrypoint) ? builtEntrypoint.href : sourceEntrypoint.href);

try {
  const result = await main(process.argv.slice(2));
  if (result?.ok === false) process.exitCode = 1;
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
