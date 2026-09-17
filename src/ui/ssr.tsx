/** @jsxImportSource hono/jsx */

import { jsxRenderer } from "hono/jsx-renderer";
import type { MiddlewareHandler } from "hono";

export interface SsrDocumentOptions {
  title?: string;
  lang?: string;
  bodyClass?: string;
  stylesheets?: readonly string[];
}

/**
 * Create the standard Worker-side HTML shell. This is intentionally separate from
 * the React UI exports: Hono JSX is excellent for edge-rendered documents, while
 * React remains the right runtime for the interactive browser admin components.
 *
 * Usage:
 *   app.use("/admin/*", createSsrRenderer({ title: "Administration" }));
 *   app.get("/admin", (c) => c.render(<AdminLanding />));
 */
export function createSsrRenderer(
  options: SsrDocumentOptions = {},
): MiddlewareHandler {
  const {
    title = "Cloudflare Worker",
    lang = "en",
    bodyClass,
    stylesheets = [],
  } = options;

  return jsxRenderer(({ children }) => (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {stylesheets.map((href) => (
          <link key={href} rel="stylesheet" href={href} />
        ))}
      </head>
      <body class={bodyClass}>{children}</body>
    </html>
  ));
}
