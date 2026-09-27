ALTER TABLE auth_users ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1));
ALTER TABLE auth_tenants ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1));
ALTER TABLE auth_groups ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1));
ALTER TABLE auth_scopes ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1));

CREATE TABLE IF NOT EXISTS auth_group_scopes (
  group_name TEXT NOT NULL REFERENCES auth_groups(name) ON DELETE CASCADE,
  scope_name TEXT NOT NULL REFERENCES auth_scopes(name) ON DELETE CASCADE,
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_name, scope_name)
);
CREATE INDEX IF NOT EXISTS auth_group_scopes_scope_idx ON auth_group_scopes(scope_name);

CREATE TABLE IF NOT EXISTS core_audit_log (
  id TEXT PRIMARY KEY,
  who TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS core_audit_log_created_idx ON core_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS core_audit_log_who_idx ON core_audit_log(who);
