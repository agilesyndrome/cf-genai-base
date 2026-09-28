-- Shared storage for records that do not opt into immutable versioning.
CREATE TABLE IF NOT EXISTS data_records (
  record_type TEXT NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK (json_valid(content_json)),
  created_by TEXT NOT NULL REFERENCES auth_users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (record_type, tenant_id, id)
);

CREATE INDEX IF NOT EXISTS data_records_tenant_idx
  ON data_records (record_type, tenant_id, id);
