import { createWorker, defineApp, VersionedObjectDomain } from "../../../src/index.js";
import { basicUsers } from "./demo-auth.js";
import { page } from "./page.js";

// A managed domain supplies schema-backed routes, revisions, publication, stamps, and ratings.
const todos = new VersionedObjectDomain({
  name: "todos",
  basePath: "/api/todos",
  fields: { title: "string", done: "boolean" },
  readScope: "todos:read",
  writeScope: "todos:write",
  publishScope: "todos:publish",
  passport: { maximum: "tenant", default: "private", userChoice: true, scope: "todos:engage" },
  ratings: { scale: ["rough", "fine", "great"], maximum: "tenant", default: "private", userChoice: true, scope: "todos:engage" },
});

export const app = defineApp({ name: "todo-list", ui: true, api: true, admin: true, features: [basicUsers], domains: [todos] });
export default createWorker({
  app,
  requiredBindings: ["DB"],
  fetch: async (request) => new URL(request.url).pathname === "/" ? page() : new Response("Not found", { status: 404 }),
});
