import { copyFile, mkdir } from "node:fs/promises";

const outputDirectory = new URL("../dist/ui/", import.meta.url);
await mkdir(outputDirectory, { recursive: true });
await copyFile(new URL("../src/ui/styles.css", import.meta.url), new URL("styles.css", outputDirectory));
