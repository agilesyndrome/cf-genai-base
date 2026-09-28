/** @jsxImportSource hono/jsx */
import * as React from "hono/jsx";

import { renderSiteDocument } from "../../../../../src/ui/ssr.js";
import { HeroArt } from "../components/hero-art.js";
import { Navigation } from "../components/navigation.js";

// The page owns its identity; generated base APIs own its records and engagement.
export function page(): Response {
  const html = renderSiteDocument({
    title: "Little by little | Todo list",
    description: "A small, versioned list of things worth doing.",
    themeColor: "#fff8e8",
    stylesheets: ["/todo.css"],
    scripts: [{ src: "/todo.js", type: "module" }],
    children: <>
      <Navigation />
      <main>
        <section class="hero" aria-labelledby="page-title">
          <div class="hero-copy">
            <p class="eyebrow">THE EVERYDAY NOTEBOOK <span aria-hidden="true">✳</span> NO. 01</p>
            <h1 id="page-title">The little things <em>add up.</em></h1>
            <p class="hero-description">Keep your plans in one place. Check them off, save the ones that matter, and look back on how they went.</p>
            <a class="text-link" href="#your-list">Get started <span aria-hidden="true">↗</span></a>
          </div>
          <HeroArt />
        </section>
        <section class="list-section" id="your-list" aria-labelledby="list-title">
          <div class="section-heading"><div><p class="eyebrow">YOUR EVERYDAY LIST</p><h2 id="list-title">Things to do</h2></div><span class="section-flourish" aria-hidden="true">❧</span></div>
          <div class="list-card">
            <form id="new-todo" class="new-todo"><label class="sr-only" for="title">New task</label><input id="title" type="text" placeholder="What needs doing?" maxLength={200} required /><button class="button button-primary" type="submit">Add to list <span aria-hidden="true">↗</span></button></form>
            <p id="status" class="status" role="status" aria-live="polite"></p>
            <div id="todos" class="todo-list" aria-label="Tasks"></div>
          </div>
          <p class="list-footnote">Every save keeps a revision. Stamps stay with you; you can rate the same task more than once.</p>
        </section>
      </main>
      <footer class="site-footer"><span>Little by little <span aria-hidden="true">✳</span></span><span>Make room for what matters.</span></footer>
    </>,
  });
  return new Response(`<!doctype html>${html}`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
