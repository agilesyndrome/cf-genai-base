-- One personal stamp per object, with an unlimited history of rating events.
CREATE TABLE IF NOT EXISTS data_object_passports (
  object_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'tenant', 'public')),
  stamped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (object_type, tenant_id, record_id, user_id),
  FOREIGN KEY (object_type, tenant_id, record_id)
    REFERENCES data_object_records(object_type, tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS data_object_passports_user_idx
  ON data_object_passports (tenant_id, user_id, stamped_at);

CREATE TABLE IF NOT EXISTS data_object_ratings (
  id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  value TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private', 'tenant', 'public')),
  rated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (object_type, tenant_id, record_id, user_id)
    REFERENCES data_object_passports(object_type, tenant_id, record_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (object_type, tenant_id, record_id, revision)
    REFERENCES data_object_versions(object_type, tenant_id, record_id, revision)
);

CREATE INDEX IF NOT EXISTS data_object_ratings_record_idx
  ON data_object_ratings (object_type, tenant_id, record_id, rated_at);
