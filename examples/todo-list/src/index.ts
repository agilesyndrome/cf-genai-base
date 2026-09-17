import {
  AppDomain,
  createWorker,
  defineApp,
  defineFeature,
  type DomainRequestContext,
  type RuntimeFeature,
} from "../../../src/index.js";
import { badRequest, notFound, readJsonObject, stringField } from "../../../src/api/http.js";

const USERS = new Map([
  ["alice", { id: "northwind-alice", subject: "alice", email: "alice@northwind.test", name: "Alice Northwind" }],
  ["bob", { id: "northwind-bob", subject: "bob", email: "bob@northwind.test", name: "Bob Northwind" }],
  ["carol", { id: "contoso-carol", subject: "carol", email: "carol@contoso.test", name: "Carol Contoso" }],
  ["dan", { id: "contoso-dan", subject: "dan", email: "dan@contoso.test", name: "Dan Contoso" }],
]);

const basicUsers: RuntimeFeature = {
  name: "todo-basic-auth",
  displayName: "Todo Basic Auth",
  getUser(request) {
    const header = request.headers.get("Authorization") || "";
    if (!header.startsWith("Basic ")) return null;
    let decoded = "";
    try { decoded = atob(header.slice(6)); } catch { return null; }
    const [username, password] = decoded.split(":", 2);
    if (password !== "todo-demo" || !username || !USERS.has(username)) return null;
    const user = USERS.get(username)!;
    return { sub: user.subject, email: user.email, name: user.name, auth_strategy: "basic", authUser: { ...user, provider: "basic", is_admin: false } };
  },
  async middleware(request, _env, _ctx, next, _state) {
    if (new URL(request.url).pathname === "/" || new URL(request.url).pathname.startsWith("/api/todos")) {
      const header = request.headers.get("Authorization") || "";
      if (!header.startsWith("Basic ")) return Response.json({ error: "Basic authentication required" }, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="todo-list"' } });
    }
    return next(request);
  },
};

type Context = DomainRequestContext<any, any>;

const todos = {
  name: "todos",
  table: "todo_items",
  scope: "tenant" as const,
  columns: ["id", "tenant_id", "owner_id", "title", "done", "created_at", "updated_at"],
  readableColumns: ["id", "owner_id", "title", "done", "created_at", "updated_at"],
  writableColumns: ["id", "title", "done"],
  operationScopes: { create: "todos:create", update: "todos:update", delete: "todos:delete" },
};

class TodoDomain extends AppDomain {
  constructor() {
    super({ name: "todo.items", basePath: "/api/todos", auth: "user", scopes: "todos:read", dataResources: [todos] });
    this.route({ method: "GET", handler: list });
    this.route({ method: "POST", csrf: true, scopes: "todos:create", handler: create });
    this.route({ method: ["PATCH", "PUT"], path: "/:todoId", csrf: true, scopes: "todos:update", handler: update });
    this.route({ method: "DELETE", path: "/:todoId", csrf: true, scopes: "todos:delete", handler: remove });
  }
}

async function tenant(context: Context): Promise<string | Response> {
  const data = await context.state.data.context();
  return data.invalidTenant || !data.tenantId ? Response.json({ error: "Choose a tenant you belong to" }, { status: 403 }) : data.tenantId;
}

async function list(context: Context) {
  const selected = await tenant(context); if (selected instanceof Response) return selected;
  const rows = await context.state.data.tenant.list("todos", { orderBy: "created_at DESC" });
  return Response.json({ tenantId: selected, todos: rows });
}

async function create(context: Context) {
  const selected = await tenant(context); if (selected instanceof Response) return selected;
  const body = await readJsonObject(context.request); const title = stringField(body, "title")?.trim();
  if (!title) return badRequest("title is required");
  const userId = context.state.authUser?.id || "";
  const todo = await context.state.data.tenant.insert("todos", { id: crypto.randomUUID(), owner_id: userId, title, done: 0 });
  return Response.json({ todo }, { status: 201 });
}

async function update(context: Context) {
  const selected = await tenant(context); if (selected instanceof Response) return selected;
  const body = await readJsonObject(context.request); const changes: Record<string, unknown> = {};
  if (typeof body?.title === "string" && body.title.trim()) changes.title = body.title.trim();
  if (typeof body?.done === "boolean") changes.done = body.done ? 1 : 0;
  if (!Object.keys(changes).length) return badRequest("title or done is required");
  const todo = await context.state.data.tenant.update("todos", context.params.todoId, changes);
  return todo ? Response.json({ todo }) : notFound("Todo not found");
}

async function remove(context: Context) {
  const selected = await tenant(context); if (selected instanceof Response) return selected;
  const result = await context.state.data.tenant.delete("todos", context.params.todoId);
  return Number(result.meta?.changes || 0) ? new Response(null, { status: 204 }) : notFound("Todo not found");
}

function page() {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Todo list</title><style>:root{font:16px system-ui;color:#243126;background:#f5f1e8}body{max-width:720px;margin:4rem auto;padding:0 1rem}.card{background:#fffdf8;padding:2rem;border-radius:18px;box-shadow:0 8px 30px #23301c18}h1{margin-top:0}.row{display:flex;gap:.6rem;margin:1rem 0}input{flex:1;padding:.75rem;border:1px solid #c9d1c1;border-radius:9px}button{border:0;border-radius:9px;padding:.7rem 1rem;background:#486b4a;color:white;cursor:pointer}.todo{display:flex;align-items:center;gap:.7rem;border-top:1px solid #e5e8df;padding:.8rem 0}.todo.done span{text-decoration:line-through;color:#7c847c}.meta{color:#798275;font-size:.9rem}</style></head><body><main class="card"><h1>Todo list</h1><p class="meta">Tenant-scoped, D1-backed todos. Sign in with Basic Auth.</p><form class="row"><input id="title" placeholder="What needs doing?" autocomplete="off"><button>Add</button></form><section id="todos"></section></main><script>const list=document.querySelector('#todos'),form=document.querySelector('form'),input=document.querySelector('#title');async function load(){const r=await fetch('/api/todos');const d=await r.json();list.innerHTML=(d.todos||[]).map(t=>'<label class="todo '+(t.done?'done':'')+'"><input type="checkbox" '+(t.done?'checked':'')+' data-id="'+t.id+'"><span>'+t.title+'</span><button type="button" data-delete="'+t.id+'">×</button></label>').join('')||'<p class="meta">Nothing here yet.</p>';list.querySelectorAll('input[data-id]').forEach(e=>e.onchange=()=>fetch('/api/todos/'+e.dataset.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({done:e.checked})}).then(load));list.querySelectorAll('[data-delete]').forEach(e=>e.onclick=()=>fetch('/api/todos/'+e.dataset.delete,{method:'DELETE'}).then(load))}form.onsubmit=e=>{e.preventDefault();const title=input.value.trim();if(!title)return;fetch('/api/todos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title})}).then(()=>{input.value='';load()})};load();</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const app = defineApp({ name: "todo-list", ui: true, api: true, admin: true, features: [basicUsers, defineFeature("llm")], domains: [new TodoDomain()] });
export default createWorker({ app, fetch: async (request) => new URL(request.url).pathname === "/" ? page() : new Response("Not found", { status: 404 }) });
