import { VersionedObjectDomain } from "../../../../src/index.js";

// The site declares its shape and permissions; base provides storage and routes.
export const todos = new VersionedObjectDomain({
  name: "todos",
  basePath: "/api/todos",
  fields: { title: "string", done: "boolean" },
  readScope: "todos:read",
  writeScope: "todos:write",
  publishScope: "todos:publish",
  passport: { maximum: "tenant", default: "private", userChoice: true, scope: "todos:engage" },
  ratings: { scale: ["rough", "fine", "great"], maximum: "tenant", default: "private", userChoice: true, scope: "todos:engage" },
});
