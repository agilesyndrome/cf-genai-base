import { createWorker, defineApp } from "../../../src/index.js";

export const app = defineApp();

export default createWorker({
  app,
  fetch: async () => new Response("Hello World"),
});
