-- Apply after base migrations 0001–0012. This is example data, not a second object schema.
INSERT OR IGNORE INTO auth_tenants (id, name) VALUES
  ('northwind', 'Northwind'),
  ('contoso', 'Contoso');

INSERT OR IGNORE INTO auth_users (id, provider, subject, email, display_name) VALUES
  ('northwind-alice', 'basic', 'alice', 'alice@northwind.test', 'Alice Northwind'),
  ('northwind-bob', 'basic', 'bob', 'bob@northwind.test', 'Bob Northwind'),
  ('contoso-carol', 'basic', 'carol', 'carol@contoso.test', 'Carol Contoso'),
  ('contoso-dan', 'basic', 'dan', 'dan@contoso.test', 'Dan Contoso');

INSERT OR IGNORE INTO auth_user_tenants (user_id, tenant_id) VALUES
  ('northwind-alice', 'northwind'), ('northwind-bob', 'northwind'),
  ('contoso-carol', 'contoso'), ('contoso-dan', 'contoso');

INSERT OR IGNORE INTO auth_scopes (name, label, description) VALUES
  ('todos:read', 'Read todo drafts', 'Inspect the latest revisions'),
  ('todos:write', 'Write todos', 'Create and revise todo content'),
  ('todos:publish', 'Publish todos', 'Choose the visible revision'),
  ('todos:engage', 'Engage with todos', 'Stamp and rate published todos');

INSERT OR IGNORE INTO auth_user_scopes (user_id, scope_name, granted_by)
SELECT users.id, scopes.name, 'todo-seed'
FROM auth_users users CROSS JOIN auth_scopes scopes
WHERE users.provider = 'basic' AND users.subject IN ('alice', 'bob', 'carol', 'dan')
  AND scopes.name IN ('todos:read', 'todos:write', 'todos:publish', 'todos:engage');

INSERT OR IGNORE INTO data_object_records
  (object_type, tenant_id, id, current_revision, published_revision, created_by) VALUES
  ('todos', 'northwind', 'nw-1', 1, 1, 'northwind-alice'),
  ('todos', 'northwind', 'nw-2', 1, 1, 'northwind-bob'),
  ('todos', 'contoso', 'co-1', 1, 1, 'contoso-carol'),
  ('todos', 'contoso', 'co-2', 1, 1, 'contoso-dan');

INSERT OR IGNORE INTO data_object_versions
  (object_type, tenant_id, record_id, revision, content_json, saved_by) VALUES
  ('todos', 'northwind', 'nw-1', 1, '{"title":"Buy coffee","done":false}', 'northwind-alice'),
  ('todos', 'northwind', 'nw-2', 1, '{"title":"Review the launch checklist","done":true}', 'northwind-bob'),
  ('todos', 'contoso', 'co-1', 1, '{"title":"Send the weekly update","done":false}', 'contoso-carol'),
  ('todos', 'contoso', 'co-2', 1, '{"title":"Archive last month''s notes","done":true}', 'contoso-dan');
