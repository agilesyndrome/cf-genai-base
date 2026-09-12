const styles = `:host { --cf-ui-bg:#fff; --cf-ui-surface:#f7f7f5; --cf-ui-text:#20231f; --cf-ui-muted:#687067; --cf-ui-border:#d8ddd5; --cf-ui-primary:#2f6f52; color:var(--cf-ui-text); font:15px/1.45 system-ui,sans-serif } *,*::before,*::after{box-sizing:border-box}.shell{display:grid;gap:1rem}.nav{display:flex;flex-wrap:wrap;gap:.5rem;border-bottom:1px solid var(--cf-ui-border);padding-bottom:.75rem}.nav a{color:var(--cf-ui-text);padding:.45rem .7rem;border-radius:.4rem;text-decoration:none}.nav a:hover,.nav a[aria-current=page]{background:var(--cf-ui-surface);color:var(--cf-ui-primary)}.card{background:var(--cf-ui-bg);border:1px solid var(--cf-ui-border);border-radius:.6rem;padding:1rem;overflow:auto}table{width:100%;border-collapse:collapse}th,td{padding:.65rem;border-bottom:1px solid var(--cf-ui-border);text-align:left;vertical-align:top}th{color:var(--cf-ui-muted);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}button{border:1px solid var(--cf-ui-border);border-radius:.4rem;background:var(--cf-ui-bg);color:inherit;padding:.45rem .65rem;cursor:pointer}.scope-list{display:grid;gap:.3rem;min-width:14rem}.scope-list label{display:flex;gap:.4rem;align-items:center}.status{color:var(--cf-ui-muted);min-height:1.4em}`;

export class CfAdminShell extends HTMLElement {
  connectedCallback() {
    const active = this.getAttribute("active") || "";
    this.attachShadow({ mode: "open" }).innerHTML = `<style>${styles}</style><div class="shell"><nav class="nav" part="navigation"><a href="/admin" ${active === "home" ? 'aria-current="page"' : ""}>Admin</a><a href="/admin/users" ${active === "users" ? 'aria-current="page"' : ""}>Users</a><a href="/admin/scopes" ${active === "scopes" ? 'aria-current="page"' : ""}>Scopes</a></nav><slot></slot></div>`;
  }
}

export class CfScopeBadge extends HTMLElement {
  connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = `<style>${styles}.badge{display:inline-block;border:1px solid var(--cf-ui-border);border-radius:999px;padding:.15rem .5rem;color:var(--cf-ui-primary);background:var(--cf-ui-surface);font-size:.85rem}</style><span class="badge" part="badge"></span>`; this.shadowRoot.querySelector(".badge").textContent = this.getAttribute("scope") || this.textContent || ""; }
}

export class CfUserManagement extends HTMLElement {
  async connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = `<style>${styles}</style><section class="card" part="panel"><h2>User access</h2><p class="status" part="status">Loading users and scopes…</p><table hidden part="table"><thead><tr><th>User</th><th>Scopes</th><th>Save</th></tr></thead><tbody></tbody></table></section>`; try { await this.load(); } catch (error) { this.status.textContent = error.message || "Unable to load access data."; } }
  get status() { return this.shadowRoot.querySelector(".status"); }
  async load() { const [usersResponse, scopesResponse] = await Promise.all([fetch("/api/admin/users", { credentials: "same-origin" }), fetch("/api/admin/scopes", { credentials: "same-origin" })]); if (!usersResponse.ok || !scopesResponse.ok) throw new Error("Unable to load user access."); const users = (await usersResponse.json()).users || []; const scopes = (await scopesResponse.json()).scopes || []; const body = this.shadowRoot.querySelector("tbody"); body.replaceChildren(...users.map((user) => this.row(user, scopes))); this.shadowRoot.querySelector("table").hidden = false; this.status.textContent = `${users.length} user${users.length === 1 ? "" : "s"}`; }
  row(user, scopes) { const row = document.createElement("tr"); const identity = document.createElement("td"); identity.textContent = `${user.display_name || user.email || "Unnamed user"} (${user.email || "no email"})`; const grants = document.createElement("td"); const list = document.createElement("div"); list.className = "scope-list"; for (const scope of scopes) { const label = document.createElement("label"); const input = document.createElement("input"); input.type = "checkbox"; input.value = scope.name; input.checked = Boolean((user.scopes || []).includes(scope.name)); label.append(input, document.createTextNode(scope.label || scope.name)); list.append(label); } grants.append(list); const action = document.createElement("td"); const button = document.createElement("button"); button.textContent = "Save"; button.addEventListener("click", async () => { button.disabled = true; const selected = [...list.querySelectorAll("input:checked")].map((input) => input.value); const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/scopes`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scopes: selected }) }); button.disabled = false; this.status.textContent = response.ok ? "Access saved." : "Unable to save access."; }); action.append(button); row.append(identity, grants, action); return row; }
}

if (!customElements.get("cf-admin-shell")) customElements.define("cf-admin-shell", CfAdminShell);
if (!customElements.get("cf-scope-badge")) customElements.define("cf-scope-badge", CfScopeBadge);
if (!customElements.get("cf-user-management")) customElements.define("cf-user-management", CfUserManagement);

export class CfScopeCatalog extends HTMLElement {
  async connectedCallback() {
    this.attachShadow({ mode: "open" }).innerHTML = `<style>${styles}</style><section class="card" part="panel"><h2>Available scopes</h2><p class="status" part="status">Loading scopes…</p><div class="scope-list" hidden part="list"></div></section>`;
    try {
      const response = await fetch("/api/admin/scopes", { credentials: "same-origin" });
      if (!response.ok) throw new Error("Unable to load scopes.");
      const scopes = (await response.json()).scopes || [];
      const list = this.shadowRoot.querySelector(".scope-list");
      list.replaceChildren(...scopes.map((scope) => {
        const item = document.createElement("div");
        const badge = document.createElement("cf-scope-badge");
        badge.setAttribute("scope", scope.name);
        const description = document.createElement("span");
        description.textContent = scope.description || scope.label || scope.name;
        item.append(badge, description);
        return item;
      }));
      list.hidden = false;
      this.shadowRoot.querySelector(".status").textContent = `${scopes.length} scope${scopes.length === 1 ? "" : "s"}`;
    } catch (error) {
      this.shadowRoot.querySelector(".status").textContent = error.message || "Unable to load scopes.";
    }
  }
}

if (!customElements.get("cf-scope-catalog")) customElements.define("cf-scope-catalog", CfScopeCatalog);
if (!customElements.get("cf-scope-catalog")) customElements.define("cf-scope-catalog", CfScopeCatalog);
