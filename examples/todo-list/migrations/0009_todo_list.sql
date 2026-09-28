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
  ('todos:read', 'Read todos', 'List and view todo records'),
  ('todos:write', 'Write todos', 'Create and edit todo records'),
  ('todos:publish', 'Publish todos', 'Publish todo revisions');

INSERT OR IGNORE INTO auth_user_scopes (user_id, scope_name, granted_by)
SELECT id, scope_name, 'seed' FROM auth_users
JOIN (SELECT 'todos:read' AS scope_name UNION ALL SELECT 'todos:write' UNION ALL SELECT 'todos:publish')
WHERE id IN ('northwind-alice', 'northwind-bob', 'contoso-carol', 'contoso-dan');

INSERT OR IGNORE INTO data_records (record_type, tenant_id, id, content_json, created_by)
VALUES
  ('todos', 'northwind', 'nw-1', '{"title":"Buy coffee","workflow_state":"todo"}', 'northwind-alice'),
  ('todos', 'northwind', 'nw-2', '{"title":"Review the launch checklist","workflow_state":"done"}', 'northwind-bob'),
  ('todos', 'contoso', 'co-1', '{"title":"Send the weekly update","workflow_state":"todo"}', 'contoso-carol'),
  ('todos', 'contoso', 'co-2', '{"title":"Archive last month''s notes","workflow_state":"done"}', 'contoso-dan');
