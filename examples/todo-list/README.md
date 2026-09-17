# Todo list example

This is a deliberately small, complete site showing the `-base` contracts in a real Worker:

- two tenants (`northwind` and `contoso`)
- four Basic Auth users (two per tenant; password `todo-demo`)
- tenant-scoped D1 data with read/create/update/delete capabilities
- completed items remain visible and can be toggled
- a browser UI plus JSON API
- an optional `TodoAdmin` React entry point for the shared AdminDashboard

From this directory, install the repository dependencies and set a real D1 id in
`wrangler.jsonc`. Apply the eight package migrations first (from the repository's
`migrations/` directory), then execute this example's
`migrations/0009_todo_list.sql` once against the same database (for local dev,
`npx wrangler d1 execute cf-genai-todo-list --local --file migrations/0009_todo_list.sql`),
then run `npx wrangler dev`.

If the site uses React, import `src/admin.jsx` from its client entry point and
mount `<TodoAdmin />` on `/admin`; include
`@agilesyndrome/cf-genai-base/ui/styles.css`. The dashboard's system sections use
the same protected admin APIs and capability checks as the Worker.

The example imports source files so it is useful while developing this repository. A
published site should import from `@agilesyndrome/cf-genai-base` instead.

Try `alice:todo-demo`, `bob:todo-demo`, `carol:todo-demo`, and `dan:todo-demo`.
The `X-Tenant-ID` header is accepted by the base runtime; choosing another user's
tenant returns 403, and the D1 reader always adds the authenticated tenant predicate.
