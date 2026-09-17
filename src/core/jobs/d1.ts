import { createD1 } from "../database/index.js";
import type { Job, JobDefinition, JobEvent, JobEventRow, JobFilters, JobOptions, JobPatch, JobRow } from "./model.js";
import { boundedJobLimit, decodeJobValue, encodeJobValue, normalizeJobStatus, nullableString, requiredJobValue } from "./validation.js";

export async function insertJobRow(env: unknown, definition: JobDefinition, options: JobOptions = {}): Promise<Job> {
  const id = String(definition.id || crypto.randomUUID());
  const type = requiredJobValue(definition.type, "Job type");
  const status = normalizeJobStatus(definition.status || "queued");
  const now = new Date().toISOString();
  await createD1(env, { who: options.who ?? "system:update" }).prepare(`
    INSERT INTO core_jobs
      (id, type, status, owner_id, tenant_id, resource_type, resource_id,
       input_json, result_json, error_json, progress_json, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', NULL, ?, ?, ?, ?)
  `).bind(
    id,
    type,
    status,
    nullableString(definition.ownerId),
    nullableString(definition.tenantId),
    nullableString(definition.resourceType),
    nullableString(definition.resourceId),
    encodeJobValue(definition.input),
    encodeJobValue(definition.progress),
    now,
    now,
    nullableString(definition.expiresAt),
  ).run();
  const job = await getJobRow(env, id, options);
  if (!job) throw new Error(`Unable to load created job: ${id}`);
  return job;
}

export async function getJobRow(env: unknown, id: unknown, options: JobOptions = {}): Promise<Job | null> {
  const row = await createD1(env, { who: options.who ?? "system:read" })
    .prepare("SELECT * FROM core_jobs WHERE id = ?")
    .bind(String(id))
    .first<JobRow>();
  return row ? normalizeJob(row) : null;
}

export async function listJobRows(env: unknown, filters: JobFilters = {}, options: JobOptions = {}): Promise<Job[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    clauses.push(`${column} = ?`);
    values.push(value);
  };
  if (filters.ownerId !== undefined) add("owner_id", nullableString(filters.ownerId));
  if (filters.tenantId !== undefined) add("tenant_id", nullableString(filters.tenantId));
  if (filters.type) add("type", String(filters.type));
  if (filters.status) add("status", normalizeJobStatus(filters.status));
  if (filters.resourceType) add("resource_type", String(filters.resourceType));
  if (filters.resourceId) add("resource_id", String(filters.resourceId));
  const sql = `SELECT * FROM core_jobs${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`;
  const result = await createD1(env, { who: options.who ?? "system:read" })
    .prepare(sql)
    .bind(...values, boundedJobLimit(filters.limit))
    .all<JobRow>();
  return result.results.map(normalizeJob);
}

export async function listJobEventRows(
  env: unknown,
  jobId: unknown,
  options: JobOptions & { limit?: number } = {},
): Promise<JobEvent[]> {
  const result = await createD1(env, { who: options.who ?? "system:read" })
    .prepare("SELECT * FROM core_job_events WHERE job_id = ? ORDER BY created_at ASC LIMIT ?")
    .bind(String(jobId), boundedJobLimit(options.limit, 500))
    .all<JobEventRow>();
  return result.results.map(normalizeJobEvent);
}

export async function updateJobRow(env: unknown, id: unknown, current: Job, patch: JobPatch, options: JobOptions = {}): Promise<Job | null> {
  const nextStatus = patch.status === undefined ? current.status : normalizeJobStatus(patch.status);
  const fields: Array<[string, unknown]> = [
    ["status", nextStatus],
    ["result_json", patch.result === undefined ? undefined : encodeJobValue(patch.result)],
    ["error_json", patch.error === undefined ? undefined : patch.error == null ? null : encodeJobValue(patch.error)],
    ["progress_json", patch.progress === undefined ? undefined : encodeJobValue(patch.progress)],
    ["started_at", patch.startedAt === undefined ? undefined : nullableString(patch.startedAt)],
    ["finished_at", patch.finishedAt === undefined ? undefined : nullableString(patch.finishedAt)],
    ["expires_at", patch.expiresAt === undefined ? undefined : nullableString(patch.expiresAt)],
  ];
  if (nextStatus === "running" && !current.startedAt && patch.startedAt === undefined) fields[4] = ["started_at", new Date().toISOString()];
  if (["succeeded", "failed", "cancelled"].includes(nextStatus) && !current.finishedAt && patch.finishedAt === undefined) fields[5] = ["finished_at", new Date().toISOString()];
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of fields) {
    if (value !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(value);
    }
  }
  assignments.push("updated_at = ?");
  values.push(new Date().toISOString(), String(id));
  await createD1(env, { who: options.who ?? "system:update" })
    .prepare(`UPDATE core_jobs SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
  return getJobRow(env, id, options);
}

export async function insertJobEventRow(env: unknown, event: { id: string; jobId: string; type: string; payload: unknown }, options: JobOptions = {}): Promise<void> {
  await createD1(env, { who: options.who ?? "system:update" })
    .prepare("INSERT INTO core_job_events (id, job_id, type, payload_json) VALUES (?, ?, ?, ?)")
    .bind(event.id, event.jobId, event.type, encodeJobValue(event.payload))
    .run();
}

export function normalizeJob(row: JobRow): Job {
  return {
    id: String(row.id),
    type: String(row.type),
    status: normalizeJobStatus(row.status),
    ownerId: nullableString(row.owner_id),
    tenantId: nullableString(row.tenant_id),
    resourceType: nullableString(row.resource_type),
    resourceId: nullableString(row.resource_id),
    input: decodeJobValue(row.input_json),
    result: decodeJobValue(row.result_json),
    error: decodeJobValue(row.error_json),
    progress: decodeJobValue(row.progress_json),
    createdAt: nullableString(row.created_at),
    startedAt: nullableString(row.started_at),
    finishedAt: nullableString(row.finished_at),
    updatedAt: nullableString(row.updated_at),
    expiresAt: nullableString(row.expires_at),
  };
}

export function normalizeJobEvent(row: JobEventRow): JobEvent {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    type: String(row.type),
    payload: decodeJobValue(row.payload_json),
    createdAt: nullableString(row.created_at),
  };
}
