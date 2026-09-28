import {
  createApp,
  text,
  defineRecord,
  workflow,
  type RuntimeFeature,
} from "../../../src/index.js";

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
    const user = username && password === "todo-demo" ? USERS.get(username) : undefined;
    return user ? { sub: user.subject, email: user.email, name: user.name, auth_strategy: "basic", authUser: { ...user, provider: "basic", is_admin: false } } : null;
  },
  async middleware(request, _env, _ctx, next, _state) {
    if (new URL(request.url).pathname === "/" || new URL(request.url).pathname.startsWith("/api/todos")) {
      if (!request.headers.get("Authorization")?.startsWith("Basic ")) return Response.json({ error: "Basic authentication required" }, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="todo-list"' } });
    }
    return next(request);
  },
};

const todos = defineRecord({
  name: "todos",
  fields: { title: text() },
  with: [workflow({ states: ["todo", "inprogress", "done"] })],
});

function page() {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Todo list</title><style>body{max-width:680px;margin:4rem auto;padding:0 1rem;font:16px system-ui;background:#f5f1e8;color:#243126}.card{background:#fffdf8;padding:2rem;border-radius:18px}form{display:flex;gap:.5rem}input{flex:1;padding:.7rem}.todo{display:flex;gap:.7rem;padding:.8rem 0;border-top:1px solid #ddd}.done{text-decoration:line-through;color:#798275}</style></head><body><main class="card"><h1>Todo list</h1><p>One record, one workflow, no framework ceremony.</p><form><input id="title" placeholder="What needs doing?"><button>Add</button></form><section id="list"></section></main><script>const list=document.querySelector('#list'),form=document.querySelector('form'),input=document.querySelector('#title');async function api(path,options){const r=await fetch(path,options);if(!r.ok)throw new Error((await r.json()).error||'Request failed');return r.json()}async function load(){const d=await api('/api/todos');list.innerHTML=(d.records||[]).map(r=>'<label class="todo '+(r.content.workflow_state==='done'?'done':'')+'"><input type="checkbox" '+(r.content.workflow_state==='done'?'checked':'')+' data-id="'+r.id+'"><span>'+r.content.title+' ('+r.content.workflow_state+')</span></label>').join('')||'<p>Nothing here yet.</p>';list.querySelectorAll('[data-id]').forEach(e=>e.onchange=()=>api('/api/todos/'+e.dataset.id+'/workflow',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:e.checked?'done':'inprogress'})}).then(load))}form.onsubmit=e=>{e.preventDefault();const title=input.value.trim();if(!title)return;api('/api/todos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:{title}})}).then(()=>{input.value='';load()})};load().catch(e=>{list.textContent=e.message})</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default createApp({
  name: "todo-list",
  features: [basicUsers],
  records: [todos],
  fetch: async (request) => new URL(request.url).pathname === "/" ? page() : new Response("Not found", { status: 404 }),
});
