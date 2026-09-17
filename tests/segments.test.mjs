import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const sourceRoot = new URL("../src/", import.meta.url);
const segments = ["circuits", "database", "events", "healthchecks", "jobs", "security"];
const removedFlatModules = ["circuits", "d1", "event-hub", "events", "identity", "jobs", "security"];

test("core capabilities have explicit package segment exports", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  for (const segment of segments) {
    assert.deepEqual(manifest.exports[`./core/${segment}`], {
      types: `./dist/core/${segment}/index.d.ts`,
      import: `./dist/core/${segment}/index.js`,
      default: `./dist/core/${segment}/index.js`,
    });
    await accessSourceModule(`core/${segment}/index`);
  }
  assert.equal(manifest.exports["./auth/identity"].import, "./dist/auth/identity/index.js");
});

test("removed flat core modules do not return as compatibility facades", async () => {
  const entries = new Set(await readdir(new URL("../src/core/", import.meta.url)));
  for (const moduleName of removedFlatModules) {
    for (const extension of ["js", "jsx", "ts", "tsx"]) {
      const file = `${moduleName}.${extension}`;
      assert.equal(entries.has(file), false, `${file} must remain removed`);
    }
  }
});

test("built-in features use folder entrypoints without flat compatibility modules", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const entries = new Set(await readdir(new URL("../src/features/", import.meta.url)));
  for (const feature of ["llm", "messaging"]) {
    assert.equal(manifest.exports[`./features/${feature}`].import, `./dist/features/${feature}/index.js`);
    await accessSourceModule(`features/${feature}/index`);
    for (const extension of ["js", "jsx", "ts", "tsx"]) {
      assert.equal(entries.has(`${feature}.${extension}`), false, `${feature}.${extension} must remain removed`);
    }
  }
});

test("implementation modules import owning segments instead of the core barrel", async () => {
  const files = await javascriptFiles(sourceRoot);
  for (const file of files) {
    if (/^index\.[jt]s$/.test(file)) continue;
    const source = await readFile(new URL(file, sourceRoot), "utf8");
    assert.doesNotMatch(source, /from\s+["'][^"']*core\/index\.js["']/, `${file} imports the broad core barrel`);
  }
});

async function javascriptFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await javascriptFiles(new URL(`${entry.name}/`, directory), relative));
    else if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name)) files.push(relative);
  }
  return files;
}

async function accessSourceModule(relativePath) {
  for (const extension of ["ts", "tsx", "js", "jsx"]) {
    try {
      await access(new URL(`../src/${relativePath}.${extension}`, import.meta.url));
      return;
    } catch {
      // Continue until a valid hybrid source extension is found.
    }
  }
  assert.fail(`Missing source module: src/${relativePath}.{ts,tsx,js,jsx}`);
}
