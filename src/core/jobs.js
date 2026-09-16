import { Event, emitEvent } from "./events.js";
import { createD1 } from "./d1.js";

export const JOB_STATUSES = Object.freeze(["queued", "running", "succeeded", "failed", "cancelled"]);
const JOB_STATUS_SET = new Set(JOB_STATUSES);
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export async function createJob(env, definition = {}, { who = "system:update", ctx } = {}) {
  const id = String(definition.id || crypto.randomUUID());
  const type = required(definition.type, "Job type");
  const status = normalizeStatus(definition.status || "queued");
  const now = new Date().toISOString();
  const db = createD1(env, { who });
  await db.prepare(`
    INSERT INTO core_jobs
      (id, type, status, owner_id, tenant_id, resource_type, resource_id,
       input_json, result_json, error_json, progress_json, created_at, updated_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', NULL, ?, ?, ?, ?)
  `).bind(
    id,
    type,
    status,
    nullable(definition.ownerId),
    nullable(definition.tenantId),
    nullable(definition.resourceType),
    nullable(definition.resourceId),
    encode(definition.input),
    encode(definition.progress),
    now,
    now,
    nullable(definition.expiresAt),
  ).run();
  const job = await getJob(env, id, { who });
  await publishJobEvent(env, job, "job.created", who, ctx);
  return job;
}

export async function getJob(env, id, { who = "system:read" } = {}) {
  const row = await createD1(env, { who }).prepare("SELECT * FROM core_jobs WHERE id = ?").bind(String(id)).first();
  return row ? normalizeJob(row) : null;
}

export async function listJobs(env, filters = {}, { who = "system:read" } = {}) {
  const clauses = [];
  const values = [];
  if (filters.ownerId !== undefined) { clauses.push("owner_id = ?"); values.push(nullable(filters.ownerId)); }
  if (filters.tenantId !== undefined) { clauses.push("tenant_id = ?"); values.push(nullable(filters.tenantId)); }
  if (filters.type) { clauses.push("type = ?"); values.push(String(filters.type)); }
  if (filters.status) { clauses.push("status = ?"); values.push(normalizeStatus(filters.status)); }
  if (filters.resourceType) { clauses.push("resource_type = ?"); values.push(String(filters.resourceType)); }
  if (filters.resourceId) { clauses.push("resource_id = ?"); values.push(String(filters.resourceId)); }
  const limit = boundedLimit(filters.limit);
  const sql = `SELECT * FROM core_jobs${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT ?`;
  const result = await createD1(env, { who }).prepare(sql).bind(...values, limit).all();
  return (result?.results || []).map(normalizeJob);
}

export async function listJobEvents(env, jobId, { who = "system:read", limit = 100 } = {}) {
  const result = await createD1(env, { who }).prepare("SELECT * FROM core_job_events WHERE job_id = ? ORDER BY created_at ASC LIMIT ?").bind(String(jobId), boundedLimit(limit, 500)).all();
  return (result?.results || []).map(normalizeJobEvent);
}

export async function startJob(env, id, options = {}) {
  return updateJob(env, id, { status: "running", startedAt: new Date().toISOString() }, options);
}

export async function updateJobProgress(env, id, progress, options = {}) {
  return updateJob(env, id, { progress }, options);
}

export async function completeJob(env, id, result = {}, options = {}) {
  return updateJob(env, id, { status: "succeeded", result, finishedAt: new Date().toISOString() }, options);
}

export async function failJob(env, id, error, options = {}) {
  const details = error instanceof Error ? { name: error.name, message: error.message, code: error.code || null } : error;
  return updateJob(env, id, { status: "failed", error: details, finishedAt: new Date().toISOString() }, options);
}

export async function cancelJob(env, id, options = {}) {
  return updateJob(env, id, { status: "cancelled", finishedAt: new Date().toISOString() }, options);
}

export async function dispatchJob(env, definition, { workflow, params = {}, retention, who = "system:update", ctx } = {}) {
  if (!workflow || typeof workflow.create !== "function") throw new TypeError("A Workflow binding is required to dispatch a job");
  const job = await createJob(env, definition, { who, ctx });
  try {
    await workflow.create({
      id: job.id,
      params: { ...params, jobId: job.id },
      ...(retention ? { retention } : {}),
    });
    return job;
  } catch (error) {
    await failJob(env, job.id, error, { who, ctx });
    throw error;
  }
}

export async function executeJob(env, id, execute, { who = "system:update", ctx, toJobResult = identity } = {}) {
  if (typeof execute !== "function") throw new TypeError("Job executor must be a function");
  const running = await startJob(env, id, { who, ctx });
  if (!running) throw new TypeError(`Unknown job: ${id}`);
  const report = (progress) => updateJobProgress(env, id, progress, { who, ctx });
  try {
    const value = await execute({ job: running, report });
    const result = await toJobResult(value);
    const job = await completeJob(env, id, result === undefined ? {} : result, { who, ctx });
    return { job, value };
  } catch (error) {
    await failJob(env, id, error, { who, ctx });
    throw error;
  }
}

export async function runJob(env, definition, execute, options = {}) {
  const job = await createJob(env, definition, options);
  return executeJob(env, job.id, execute, options);
}

export async function updateJob(env, id, patch = {}, { who = "system:update", ctx } = {}) {
  const current = await getJob(env, id, { who });
  if (!current) return null;
  const nextStatus = patch.status === undefined ? current.status : normalizeStatus(patch.status);
  const values = [];
  const assignments = [];
  const fields = [
    ["status", nextStatus],
    ["result_json", patch.result === undefined ? undefined : encode(patch.result)],
    ["error_json", patch.error === undefined ? undefined : (patch.error == null ? null : encode(patch.error))],
    ["progress_json", patch.progress === undefined ? undefined : encode(patch.progress)],
    ["started_at", patch.startedAt === undefined ? undefined : nullable(patch.startedAt)],
    ["finished_at", patch.finishedAt === undefined ? undefined : nullable(patch.finishedAt)],
    ["expires_at", patch.expiresAt === undefined ? undefined : nullable(patch.expiresAt)],
  ];
  if (nextStatus === "running" && !current.startedAt && patch.startedAt === undefined) fields[4] = ["started_at", new Date().toISOString()];
  if (TERMINAL_STATUSES.has(nextStatus) && !current.finishedAt && patch.finishedAt === undefined) fields[5] = ["finished_at", new Date().toISOString()];
  for (const [column, value] of fields) { if (value !== undefined) { assignments.push(`${column} = ?`); values.push(value); } }
  assignments.push("updated_at = ?"); values.push(new Date().toISOString(), String(id));
  await createD1(env, { who }).prepare(`UPDATE core_jobs SET ${assignments.join(", ")} WHERE id = ?`).bind(...values).run();
  const job = await getJob(env, id, { who });
  await publishJobEvent(env, job, patch.progress !== undefined && patch.status === undefined ? "job.progress" : `job.${nextStatus}`, who, ctx);
  return job;
}

export function normalizeJob(row) {
  return {
    id: String(row.id),
    type: String(row.type),
    status: String(row.status),
    ownerId: row.owner_id || null,
    tenantId: row.tenant_id || null,
    resourceType: row.resource_type || null,
    resourceId: row.resource_id || null,
    input: decode(row.input_json),
    result: decode(row.result_json),
    error: decode(row.error_json),
    progress: decode(row.progress_json),
    createdAt: row.created_at || null,
    startedAt: row.started_at || null,
    finishedAt: row.finished_at || null,
    updatedAt: row.updated_at || null,
    expiresAt: row.expires_at || null,
  };
}

export function normalizeJobEvent(row) {
  return { id: String(row.id), jobId: String(row.job_id), type: String(row.type), payload: decode(row.payload_json), createdAt: row.created_at || null };
}

async function publishJobEvent(env, job, type, who, ctx) {
  const payload = { jobId: job.id, type: job.type, status: job.status, ownerId: job.ownerId, tenantId: job.tenantId, resource: job.resourceType && job.resourceId ? { type: job.resourceType, id: job.resourceId } : null, progress: job.progress, result: type === "job.succeeded" ? job.result : undefined, error: type === "job.failed" ? job.error : undefined };
  const event = Event(who, type, "job", new Date(), { ...payload, audience: { userId: job.ownerId, tenantId: job.tenantId } });
  const db = createD1(env, { who });
  await db.prepare("INSERT INTO core_job_events (id, job_id, type, payload_json) VALUES (?, ?, ?, ?)").bind(event.id, job.id, type, encode(payload)).run();
  await emitEvent(env, event, ctx);
}

function normalizeStatus(status) { const value = String(status).toLowerCase(); if (!JOB_STATUS_SET.has(value)) throw new TypeError(`Unsupported job status: ${status}`); return value; }
function required(value, label) { const normalized = String(value || "").trim(); if (!normalized) throw new TypeError(`${label} is required`); return normalized; }
function nullable(value) { return value === undefined || value === null || value === "" ? null : String(value); }
function encode(value) { return JSON.stringify(value === undefined ? {} : value); }
function decode(value) { if (value == null || value === "") return null; try { return JSON.parse(value); } catch { return null; } }
function boundedLimit(value, maximum = 100) { const normalized = Number(value); return Number.isFinite(normalized) && normalized > 0 ? Math.min(Math.floor(normalized), maximum) : Math.min(50, maximum); }
function identity(value) { return value; }
