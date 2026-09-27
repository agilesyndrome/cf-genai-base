import { readFile, readdir, writeFile } from "node:fs/promises";

const write = process.argv.includes("--write");
const root = new URL("../src/", import.meta.url);

for (const file of await sourceFiles(root)) {
  const original = await readFile(file, "utf8");
  const formatted = original
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n*$/, "\n");
  if (write) {
    if (formatted !== original) await writeFile(file, formatted);
  } else if (formatted !== original) {
    console.error(`${file.pathname.slice(root.pathname.length)} is not formatted`);
    process.exitCode = 1;
  }
}

if (write) console.log("Source whitespace normalized.");

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.tsx?$/.test(file.pathname)) files.push(file);
  }
  return files;
}
