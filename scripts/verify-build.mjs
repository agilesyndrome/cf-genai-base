import { access, readFile, readdir } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));

for (const [subpath, definition] of Object.entries(manifest.exports)) {
  if (subpath.includes("*") || typeof definition === "string") {
    if (typeof definition === "string") await access(new URL(definition, repositoryRoot));
    continue;
  }

  await access(new URL(definition.types, repositoryRoot));
  await access(new URL(definition.import, repositoryRoot));
  if (definition.default !== definition.import) {
    throw new Error(`${subpath} must use the same ESM import and default target`);
  }

  // DurableObject is provided by the Workers runtime and is not constructible
  // in a plain Node.js package smoke test.
  if (subpath !== "./event-hub") await import(new URL(definition.import, repositoryRoot));
}

const migratedDeclarations = [
  "dist/core/events/index.d.ts",
  "dist/core/events/hub.d.ts",
  ...["cli", "d1", "operations", "project", "status", "tenants", "types", "users", "version"].map((name) => `dist/cli/${name}.d.ts`),
  ...["admin-access", "admin-catalogs", "admin-dashboard", "admin-details", "admin-shell", "foundation", "index", "jobs", "live-events", "types"].map((name) => `dist/ui/react/${name}.d.ts`),
];

for (const declaration of migratedDeclarations) {
  const url = new URL(declaration, repositoryRoot);
  await access(url);
}

for (const declaration of await sourceFiles(new URL("dist/", repositoryRoot))) {
  if (!declaration.pathname.endsWith(".d.ts")) continue;
  const source = stripCommentsAndStrings(await readFile(declaration, "utf8"));
  if (/\bany\b/.test(source)) {
    throw new Error(`${declaration.pathname} contains an emitted any type`);
  }
}

for (const moduleName of ["d1", "operations", "project", "status", "tenants", "users", "version"]) {
  await import(new URL(`dist/cli/${moduleName}.js`, repositoryRoot));
}

const compiledCli = await import(new URL("dist/cli/cli.js", repositoryRoot));
let cliOutput = "";
const originalLog = console.log;
console.log = (value = "") => { cliOutput += String(value); };
try { await compiledCli.main(["--help"], {}); } finally { console.log = originalLog; }
if (!cliOutput.startsWith("Usage:\n")) throw new Error("compiled CLI entrypoint failed");

const binPath = manifest.bin?.["cf-genai"];
if (binPath !== "bin/cf-genai.js") throw new Error("package bin must remain bin/cf-genai.js");
const binSource = await readFile(new URL(binPath, repositoryRoot), "utf8");
if (!binSource.startsWith("#!/usr/bin/env node\n") || !binSource.includes("dist/cli/cli.js") || !binSource.includes("src/cli/cli.js")) {
  throw new Error("bin/cf-genai.js must preserve the shebang and source/dist fallback");
}

const sourceRoot = new URL("src/", repositoryRoot);
for (const path of await sourceFiles(sourceRoot)) {
  if (/\.(?:js|jsx)$/.test(path.pathname)) throw new Error(`${path.pathname} must be migrated to TypeScript`);
  if (/\.tsx?$/.test(path.pathname)) {
    const source = await readFile(path, "utf8");
    if (/\bany\b/.test(stripCommentsAndStrings(source))) {
      throw new Error(`${path.pathname} contains an explicit any type`);
    }
    if (/\bas\s+unknown\s+as\b/.test(source)) {
      throw new Error(`${path.pathname} contains an unchecked double assertion`);
    }
  }
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(url));
    else files.push(url);
  }
  return files;
}

function stripCommentsAndStrings(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "code" && character === "/" && next === "/") {
      state = "line-comment";
      result += "  ";
      index += 1;
    } else if (state === "code" && character === "/" && next === "*") {
      state = "block-comment";
      result += "  ";
      index += 1;
    } else if (state === "code" && (character === "\"" || character === "'" || character === "`")) {
      state = character;
      result += " ";
    } else if (state === "line-comment" && character === "\n") {
      state = "code";
      result += "\n";
    } else if (state === "block-comment" && character === "*" && next === "/") {
      state = "code";
      result += "  ";
      index += 1;
    } else if ((state === "\"" || state === "'" || state === "`") && character === "\\") {
      result += "  ";
      index += 1;
    } else if (character === state) {
      state = "code";
      result += " ";
    } else {
      result += state === "code" ? character : character === "\n" ? "\n" : " ";
    }
  }
  return result;
}
