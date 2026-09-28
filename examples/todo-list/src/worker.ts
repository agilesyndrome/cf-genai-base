import { createWorker, defineApp } from "../../../src/index.js";
import { basicUsers } from "./middleware/demo-auth.js";
import { page } from "./ui/pages/index.js";

import { todos } from "./domains/todos.js";

export const app = defineApp({ name: "todo-list", ui: true, api: true, admin: true, features: [basicUsers], domains: [todos] });
export default createWorker({
  app,
  requiredBindings: ["DB"],
  fetch: async (request) => new URL(request.url).pathname === "/" ? page() : new Response("Not found", { status: 404 }),
});
