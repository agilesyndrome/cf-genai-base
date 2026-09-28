import type { RuntimeFeature } from "../../../src/index.js";

const users = new Map([
  ["alice", { id: "northwind-alice", subject: "alice", email: "alice@northwind.test", name: "Alice Northwind" }],
  ["bob", { id: "northwind-bob", subject: "bob", email: "bob@northwind.test", name: "Bob Northwind" }],
  ["carol", { id: "contoso-carol", subject: "carol", email: "carol@contoso.test", name: "Carol Contoso" }],
  ["dan", { id: "contoso-dan", subject: "dan", email: "dan@contoso.test", name: "Dan Contoso" }],
]);

// This small fixed credential set is for the local example only.
export const basicUsers: RuntimeFeature = {
  name: "todo-basic-auth",
  displayName: "Todo Basic Auth",
  getUser(request) {
    const header = request.headers.get("Authorization") || "";
    if (!header.startsWith("Basic ")) return null;
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch { return null; }
    const [username, password] = decoded.split(":", 2);
    if (password !== "todo-demo" || !username || !users.has(username)) return null;
    const user = users.get(username)!;
    return { sub: user.subject, email: user.email, name: user.name, auth_strategy: "basic", authUser: { ...user, provider: "basic", is_admin: false } };
  },
  async middleware(request, _env, _ctx, next) {
    const path = new URL(request.url).pathname;
    if (path === "/" || path.startsWith("/api/todos")) {
      const header = request.headers.get("Authorization") || "";
      if (!header.startsWith("Basic ")) {
        return Response.json({ error: "Basic authentication required" }, {
          status: 401, headers: { "WWW-Authenticate": 'Basic realm="todo-list"' },
        });
      }
    }
    return next(request);
  },
};
