# Todo list example

This is a small v6 Worker site built with `VersionedObjectDomain`:

- two tenants (`northwind` and `contoso`)
- four Basic Auth users (two per tenant; password `todo-demo`)
- tenant-scoped, immutable todo revisions and an explicit published pointer
- completed items remain visible; archiving unpublishes rather than deleting history
- personal passport stamps and repeatable `rough` / `fine` / `great` ratings
- private or tenant-visible stamp and rating choices, capped by site policy
- a browser UI plus JSON API
- an optional `TodoAdmin` React entry point for the shared AdminDashboard

Install the repository dependencies at its root and set a real D1 id in
`wrangler.jsonc`. From this example directory, apply the package migrations
(including `0011_versioned_objects.sql` and `0012_object_engagement.sql`),
then seed the example's users, scopes, and published todo revisions:

```sh
npx wrangler d1 migrations apply cf-genai-todo-list --local
npx wrangler d1 execute cf-genai-todo-list --local --file migrations/0013_todo_seed.sql
npx wrangler dev
```

The seed is repeatable. For a remote database, review the same migrations and
seed before applying them to that database. The UI creates a draft, then publishes
it; toggling completion saves a new revision and publishes that revision. A 409
means another save won the revision race, so the UI reloads the current record.

If the site uses React, import `src/admin.jsx` from its client entry point and
mount `<TodoAdmin />` on `/admin`; include
`@agilesyndrome/cf-genai-base/ui/styles.css`. The dashboard's system sections use
the same protected admin APIs and capability checks as the Worker.

The example imports source files so it is useful while developing this repository. A
published site should import from `@agilesyndrome/cf-genai-base` instead.

Try `alice:todo-demo`, `bob:todo-demo`, `carol:todo-demo`, and `dan:todo-demo`.
The `X-Tenant-ID` header is accepted by the base runtime; choosing another user's
tenant returns 403. The managed object store uses the validated tenant on every
read and write. Stamps and ratings require a published todo; ratings record the
published revision at the time of the rating.
