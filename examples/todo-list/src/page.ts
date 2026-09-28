/** A small browser client for the generated v6 object and engagement routes. */
export function page(): Response {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Todo list</title>
  <style>
    :root { font: 16px system-ui; color: #243126; background: #f5f1e8; }
    body { max-width: 760px; margin: 4rem auto; padding: 0 1rem; }
    main { background: #fffdf8; padding: 2rem; border-radius: 18px; box-shadow: 0 8px 30px #23301c18; }
    form, .actions, .todo { display: flex; align-items: center; gap: .6rem; }
    form { margin: 1rem 0; }
    input[type=text] { flex: 1; min-width: 0; padding: .7rem; border: 1px solid #c9d1c1; border-radius: 8px; }
    button, select { padding: .6rem; border: 1px solid #becfbb; border-radius: 8px; background: #fff; color: inherit; }
    button { cursor: pointer; }
    button.primary { background: #486b4a; border-color: #486b4a; color: white; }
    .todo { justify-content: space-between; flex-wrap: wrap; border-top: 1px solid #e5e8df; padding: .9rem 0; }
    .title { display: flex; align-items: center; gap: .5rem; }
    .done { text-decoration: line-through; color: #7c847c; }
    .meta { color: #66756a; font-size: .9rem; }
    #status { min-height: 1.4em; }
  </style>
</head>
<body>
  <main>
    <h1>Todo list</h1>
    <p class="meta">Tenant-scoped, versioned tasks. Save a task to your passport or rate how it went.</p>
    <form id="new-todo"><input id="title" type="text" placeholder="What needs doing?" required><button class="primary">Add</button></form>
    <p id="status" role="status"></p>
    <section id="todos" aria-label="Tasks"></section>
  </main>
  <script type="module">
    const list = document.querySelector('#todos');
    const form = document.querySelector('#new-todo');
    const title = document.querySelector('#title');
    const status = document.querySelector('#status');

    async function api(path, method = 'GET', data) {
      const response = await fetch(path, {
        method,
        ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed');
      return result;
    }

    async function refresh() {
      const [collection, passport] = await Promise.all([api('/api/todos'), api('/api/todos/passport')]);
      const stamped = new Set(passport.stamps.map((item) => item.recordId));
      list.replaceChildren();
      if (!collection.records.length) list.textContent = 'Nothing here yet.';

      for (const record of collection.records) {
        const row = document.createElement('div');
        row.className = 'todo';
        const label = document.createElement('label');
        label.className = 'title';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = record.content.done;
        const text = document.createElement('span');
        text.textContent = record.content.title;
        if (record.content.done) text.className = 'done';
        label.append(checkbox, text);

        const actions = document.createElement('div');
        actions.className = 'actions';
        const stamp = document.createElement('button');
        stamp.type = 'button';
        stamp.textContent = stamped.has(record.id) ? 'Stamped ✓' : 'Stamp';
        stamp.disabled = stamped.has(record.id);
        const rating = document.createElement('select');
        rating.setAttribute('aria-label', 'How did it go?');
        for (const value of ['rough', 'fine', 'great']) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          rating.append(option);
        }
        const rate = document.createElement('button');
        rate.type = 'button';
        rate.textContent = 'Rate';
        const archive = document.createElement('button');
        archive.type = 'button';
        archive.textContent = 'Archive';
        actions.append(stamp, rating, rate, archive);
        row.append(label, actions);
        list.append(row);

        checkbox.onchange = () => run(async () => {
          const saved = await api('/api/todos/' + record.id, 'PUT', {
            expectedRevision: record.revision,
            content: { ...record.content, done: checkbox.checked },
          });
          await api('/api/todos/' + record.id + '/publish', 'POST', { revision: saved.revision });
        });
        stamp.onclick = () => run(() => api('/api/todos/' + record.id + '/passport', 'PUT', {}));
        rate.onclick = () => run(() => api('/api/todos/' + record.id + '/ratings', 'POST', { value: rating.value }));
        archive.onclick = () => run(() => api('/api/todos/' + record.id + '/publish', 'DELETE'));
      }
    }

    async function run(action) {
      status.textContent = '';
      try { await action(); await refresh(); }
      catch (error) { status.textContent = error.message; await refresh(); }
    }

    form.onsubmit = (event) => {
      event.preventDefault();
      const value = title.value.trim();
      if (!value) return;
      run(async () => {
        const created = await api('/api/todos', 'POST', { content: { title: value, done: false } });
        await api('/api/todos/' + created.id + '/publish', 'POST', { revision: created.revision });
        title.value = '';
      });
    };
    refresh().catch((error) => { status.textContent = error.message; });
  </script>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
