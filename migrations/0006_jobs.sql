CREATE TABLE IF NOT EXISTS core_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  owner_id TEXT,
  tenant_id TEXT,
  resource_type TEXT,
  resource_id TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  progress_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS core_jobs_owner_status_idx
  ON core_jobs(owner_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS core_jobs_type_status_idx
  ON core_jobs(type, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS core_jobs_resource_idx
  ON core_jobs(resource_type, resource_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS core_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES core_jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS core_job_events_job_created_idx
  ON core_job_events(job_id, created_at DESC);
