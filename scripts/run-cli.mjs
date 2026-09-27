import { main } from "../src/cli/cli.ts";

try {
  const result = await main(process.argv.slice(2));
  if (result?.ok === false) process.exitCode = 1;
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
