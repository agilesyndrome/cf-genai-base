/** @jsxImportSource hono/jsx */

import { jsxRenderer } from "hono/jsx-renderer";
import { renderToString } from "hono/jsx/dom/server";
import type { MiddlewareHandler } from "hono";
import type { Child } from "hono/jsx";

export interface SiteMeta {
  name?: string;
  property?: string;
  content: string;
}

export interface SiteScript {
  src: string;
  type?: string;
  async?: boolean;
  defer?: boolean;
}

export interface SsrDocumentOptions {
  title?: string;
  description?: string;
  canonicalUrl?: string;
  lang?: string;
  bodyClass?: string;
  bodyData?: Record<string, string>;
  themeColor?: string;
  siteName?: string;
  openGraph?: {
    title?: string;
    description?: string;
    type?: string;
    url?: string;
    image?: string;
  };
  meta?: readonly SiteMeta[];
  stylesheets?: readonly string[];
  scripts?: readonly SiteScript[];
}

export interface SiteDocumentProps extends SsrDocumentOptions {
  children?: Child;
}

/**
 * Render a complete, metadata-aware site document for Worker responses.
 * Content sites provide their own children and stylesheets; the base owns the
 * document contract and safe attribute rendering.
 */
export function SiteDocument({ children, ...options }: SiteDocumentProps) {
  const {
    title = "Cloudflare Worker",
    description,
    canonicalUrl,
    lang = "en",
    bodyClass,
    bodyData = {},
    themeColor,
    siteName,
    openGraph,
    meta = [],
    stylesheets = [],
    scripts = [],
  } = options;
  const graph = openGraph || {};

  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {description ? <meta name="description" content={description} /> : null}
        {canonicalUrl ? <link rel="canonical" href={canonicalUrl} /> : null}
        {themeColor ? <meta name="theme-color" content={themeColor} /> : null}
        {siteName ? <meta property="og:site_name" content={siteName} /> : null}
        {graph.title || title ? <meta property="og:title" content={graph.title || title} /> : null}
        {graph.description || description ? <meta property="og:description" content={graph.description || description} /> : null}
        {graph.type ? <meta property="og:type" content={graph.type} /> : null}
        {graph.url || canonicalUrl ? <meta property="og:url" content={graph.url || canonicalUrl} /> : null}
        {graph.image ? <meta property="og:image" content={graph.image} /> : null}
        {meta.map((item, index) => <meta key={`${item.name || item.property}-${index}`} {...item} />)}
        {stylesheets.map((href) => <link key={href} rel="stylesheet" href={href} />)}
      </head>
      <body class={bodyClass} {...Object.fromEntries(Object.entries(bodyData).map(([key, value]) => [`data-${key}`, value]))}>
        {children}
        {scripts.map((script) => <script key={script.src} src={script.src} type={script.type} async={script.async} defer={script.defer} />)}
      </body>
    </html>
  );
}

export function renderSiteDocument(document: SiteDocumentProps): string {
  return renderToString(<SiteDocument {...document} />);
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
  return jsxRenderer(({ children }) => <SiteDocument {...options}>{children}</SiteDocument>);
}
