-- Shared storage for tenant-owned records with optional versioning.
CREATE TABLE IF NOT EXISTS data_record_records (
  record_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  current_revision INTEGER NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  published_revision INTEGER CHECK (published_revision IS NULL OR published_revision > 0),
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (record_type, tenant_id, id),
  CHECK (published_revision IS NULL OR published_revision <= current_revision)
);

CREATE TABLE IF NOT EXISTS data_record_versions (
  record_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  saved_by TEXT NOT NULL REFERENCES auth_users(id),
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (record_type, tenant_id, record_id, revision),
  FOREIGN KEY (record_type, tenant_id, record_id)
    REFERENCES data_record_records(record_type, tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS data_record_published_idx
  ON data_record_records (record_type, tenant_id, published_revision, id);
