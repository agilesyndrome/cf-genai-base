import { build } from "esbuild";

// Keep page assets generated from the site's browser and style sources.
await build({
  entryPoints: {
    todo: new URL("../src/ui/browser/site.ts", import.meta.url).pathname,
  },
  outdir: new URL("../public/", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  target: "es2022",
});
await build({
  entryPoints: { todo: new URL("../src/ui/styles/index.css", import.meta.url).pathname },
  outdir: new URL("../public/", import.meta.url).pathname,
  bundle: true,
});
