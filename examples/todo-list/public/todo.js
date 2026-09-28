// examples/todo-list/src/ui/browser/behaviors/todos.ts
async function api(path, method = "GET", data) {
  const response = await fetch(path, {
    method,
    ...data === void 0 ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed");
  return result;
}
function button(label, className = "button") {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
}
function visibility(label) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", label);
  for (const value of ["private", "tenant"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "private" ? "Just me" : "My team";
    select.appendChild(option);
  }
  return select;
}
function startTodos() {
  const list = document.querySelector("#todos");
  const form = document.querySelector("#new-todo");
  const title = document.querySelector("#title");
  const status = document.querySelector("#status");
  if (!list || !form || !title || !status) return;
  async function refresh() {
    const [collection, passport] = await Promise.all([
      api("/api/todos"),
      api("/api/todos/passport")
    ]);
    const stamped = new Set(passport.stamps.map((item) => item.recordId));
    list.replaceChildren();
    if (!collection.records.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "A fresh page. Add your first thing to do above.";
      list.appendChild(empty);
    }
    for (const record of collection.records) {
      const row = document.createElement("article");
      row.className = "todo";
      const label = document.createElement("label");
      label.className = "todo-title";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = record.content.done;
      const text = document.createElement("span");
      text.textContent = record.content.title;
      if (record.content.done) text.className = "done";
      label.appendChild(checkbox);
      label.appendChild(text);
      const details = document.createElement("div");
      details.className = "todo-details";
      const revision = document.createElement("span");
      revision.className = "revision";
      revision.textContent = `Edition ${record.revision}`;
      const actions = document.createElement("div");
      actions.className = "actions";
      const stampVisibility = visibility("Stamp visibility");
      const stamp = button(stamped.has(record.id) ? "Stamped \u2713" : "Stamp it");
      stamp.disabled = stamped.has(record.id);
      const rating = document.createElement("select");
      rating.setAttribute("aria-label", "How did it go?");
      for (const value of ["rough", "fine", "great"]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value[0].toUpperCase() + value.slice(1);
        rating.appendChild(option);
      }
      const ratingVisibility = visibility("Rating visibility");
      const rate = button("Rate it");
      const archive = button("Archive", "button button-quiet");
      for (const action of [stampVisibility, stamp, rating, ratingVisibility, rate, archive]) actions.appendChild(action);
      details.appendChild(revision);
      details.appendChild(actions);
      row.appendChild(label);
      row.appendChild(details);
      list.appendChild(row);
      checkbox.onchange = () => run(async () => {
        const saved = await api(`/api/todos/${record.id}`, "PUT", {
          expectedRevision: record.revision,
          content: { ...record.content, done: checkbox.checked }
        });
        await api(`/api/todos/${record.id}/publish`, "POST", { revision: saved.revision });
      });
      stamp.onclick = () => run(() => api(`/api/todos/${record.id}/passport`, "PUT", { visibility: stampVisibility.value }));
      rate.onclick = () => run(() => api(`/api/todos/${record.id}/ratings`, "POST", { value: rating.value, visibility: ratingVisibility.value }));
      archive.onclick = () => run(() => api(`/api/todos/${record.id}/publish`, "DELETE"));
    }
  }
  async function run(action) {
    status.textContent = "";
    try {
      await action();
      await refresh();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "Something went wrong";
      await refresh().catch(() => {
      });
    }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    const value = title.value.trim();
    if (!value) return;
    void run(async () => {
      const created = await api("/api/todos", "POST", { content: { title: value, done: false } });
      await api(`/api/todos/${created.id}/publish`, "POST", { revision: created.revision });
      title.value = "";
    });
  };
  void refresh().catch((error) => {
    status.textContent = error.message;
  });
}

// examples/todo-list/src/ui/browser/site.ts
startTodos();
