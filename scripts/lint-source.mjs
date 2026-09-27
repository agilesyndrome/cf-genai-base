import { readFile, readdir } from "node:fs/promises";

const root = new URL("../src/", import.meta.url);
const formatOnly = process.argv.includes("--format-only");
const files = await sourceFiles(root);
const violations = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const relative = file.pathname.slice(root.pathname.length);
  if (!source.endsWith("\n")) violations.push(`${relative}: missing final newline`);
  if (/\r\n/.test(source)) violations.push(`${relative}: use LF line endings`);
  if (/[ \t]+\n/.test(source)) violations.push(`${relative}: trailing whitespace`);
  if (formatOnly) continue;
  const code = stripCommentsAndStrings(source);
  if (/\bany\b/.test(code)) violations.push(`${relative}: explicit any type`);
  if (/\bas\s+unknown\s+as\b/.test(source)) violations.push(`${relative}: unchecked double assertion`);
}

if (violations.length) {
  console.error(violations.map((item) => `✖ ${item}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Source quality checks passed (${files.length} files).`);
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.tsx?$/.test(file.pathname)) files.push(file);
  }
  return files;
}

function stripCommentsAndStrings(source) {
  let result = "";
  let state = "code";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "code" && character === "/" && next === "/") { state = "line"; result += "  "; index += 1; }
    else if (state === "code" && character === "/" && next === "*") { state = "block"; result += "  "; index += 1; }
    else if (state === "code" && ["\"", "'", "`"].includes(character)) { state = character; result += " "; }
    else if (state === "line" && character === "\n") { state = "code"; result += "\n"; }
    else if (state === "block" && character === "*" && next === "/") { state = "code"; result += "  "; index += 1; }
    else if (["\"", "'", "`"].includes(state) && character === "\\") { result += "  "; index += 1; }
    else if (character === state) { state = "code"; result += " "; }
    else result += state === "code" ? character : character === "\n" ? "\n" : " ";
  }
  return result;
}
