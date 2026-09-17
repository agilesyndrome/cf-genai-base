CREATE TABLE IF NOT EXISTS todo_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS todo_items_tenant_idx ON todo_items(tenant_id, done, created_at);

INSERT OR IGNORE INTO auth_tenants (id, name) VALUES
  ('northwind', 'Northwind'),
  ('contoso', 'Contoso');

INSERT OR IGNORE INTO auth_users (id, provider, subject, email, display_name)
VALUES
  ('northwind-alice', 'basic', 'alice', 'alice@northwind.test', 'Alice Northwind'),
  ('northwind-bob', 'basic', 'bob', 'bob@northwind.test', 'Bob Northwind'),
  ('contoso-carol', 'basic', 'carol', 'carol@contoso.test', 'Carol Contoso'),
  ('contoso-dan', 'basic', 'dan', 'dan@contoso.test', 'Dan Contoso');

INSERT OR IGNORE INTO auth_user_tenants (user_id, tenant_id) VALUES
  ('northwind-alice', 'northwind'), ('northwind-bob', 'northwind'),
  ('contoso-carol', 'contoso'), ('contoso-dan', 'contoso');

INSERT OR IGNORE INTO auth_scopes (name, label, description) VALUES
  ('todos:read', 'Read todos', 'List and view todo items'),
  ('todos:create', 'Create todos', 'Create todo items'),
  ('todos:update', 'Update todos', 'Mark todo items done or change their title'),
  ('todos:delete', 'Delete todos', 'Delete todo items');

INSERT OR IGNORE INTO auth_user_scopes (user_id, scope_name, granted_by)
SELECT id, scope_name, 'seed' FROM auth_users
JOIN (SELECT 'todos:read' AS scope_name UNION ALL SELECT 'todos:create' UNION ALL SELECT 'todos:update' UNION ALL SELECT 'todos:delete')
WHERE id IN ('northwind-alice', 'northwind-bob', 'contoso-carol', 'contoso-dan');

INSERT OR IGNORE INTO todo_items (id, tenant_id, owner_id, title, done) VALUES
  ('nw-1', 'northwind', 'northwind-alice', 'Buy coffee', 0),
  ('nw-2', 'northwind', 'northwind-bob', 'Review the launch checklist', 1),
  ('co-1', 'contoso', 'contoso-carol', 'Send the weekly update', 0),
  ('co-2', 'contoso', 'contoso-dan', 'Archive last month''s notes', 1);
