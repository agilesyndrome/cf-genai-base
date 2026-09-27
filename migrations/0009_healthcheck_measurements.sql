-- Track the last persisted health measurement separately from manifest updates.
ALTER TABLE core_healthchecks ADD COLUMN checked_at TEXT;
CREATE INDEX IF NOT EXISTS core_healthchecks_checked_idx ON core_healthchecks(checked_at);
