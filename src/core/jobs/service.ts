import { getJobRow, insertJobRow, listJobEventRows, listJobRows, updateJobRow } from "./d1.js";
import { publishJobEvent } from "./events.js";
import type { Job, JobDefinition, JobFilters, JobOptions, JobPatch } from "./model.js";

export async function createJob(env: unknown, definition: JobDefinition, options: JobOptions = {}): Promise<Job> {
  const job = await insertJobRow(env, definition, options);
  await publishJobEvent(env, job, "job.created", options);
  return job;
}

export const getJob = getJobRow;
export const listJobs = listJobRows;
export const listJobEvents = listJobEventRows;

export function startJob(env: unknown, id: unknown, options: JobOptions = {}) {
  return updateJob(env, id, { status: "running", startedAt: new Date().toISOString() }, options);
}

export function updateJobProgress(env: unknown, id: unknown, progress: unknown, options: JobOptions = {}) {
  return updateJob(env, id, { progress }, options);
}

export function completeJob(env: unknown, id: unknown, result: unknown = {}, options: JobOptions = {}) {
  return updateJob(env, id, { status: "succeeded", result, finishedAt: new Date().toISOString() }, options);
}

export function failJob(env: unknown, id: unknown, error: unknown, options: JobOptions = {}) {
  const details = error instanceof Error
    ? { name: error.name, message: error.message, code: "code" in error ? error.code : null }
    : error;
  return updateJob(env, id, { status: "failed", error: details, finishedAt: new Date().toISOString() }, options);
}

export function cancelJob(env: unknown, id: unknown, options: JobOptions = {}) {
  return updateJob(env, id, { status: "cancelled", finishedAt: new Date().toISOString() }, options);
}

interface WorkflowBinding {
  create(options: { id: string; params: Record<string, unknown>; retention?: unknown }): Promise<unknown>;
}

export async function dispatchJob(
  env: unknown,
  definition: JobDefinition,
  options: JobOptions & { workflow?: WorkflowBinding; params?: Record<string, unknown>; retention?: unknown } = {},
): Promise<Job> {
  if (!options.workflow) throw new TypeError("A Workflow binding is required to dispatch a job");
  const job = await createJob(env, definition, options);
  try {
    await options.workflow.create({
      id: job.id,
      params: { ...(options.params ?? {}), jobId: job.id },
      ...(options.retention ? { retention: options.retention } : {}),
    });
    return job;
  } catch (error) {
    await failJob(env, job.id, error, options);
    throw error;
  }
}

export async function executeJob<Value, Result = Value>(
  env: unknown,
  id: unknown,
  execute: (context: { job: Job; report: (progress: unknown) => Promise<Job | null> }) => Value | Promise<Value>,
  options: JobOptions & { toJobResult?: (value: Value) => Result | Promise<Result> } = {},
): Promise<{ job: Job | null; value: Value }> {
  const running = await startJob(env, id, options);
  if (!running) throw new TypeError(`Unknown job: ${id}`);
  const report = (progress: unknown) => updateJobProgress(env, id, progress, options);
  try {
    const value = await execute({ job: running, report });
    const result = options.toJobResult ? await options.toJobResult(value) : value;
    const job = await completeJob(env, id, result, options);
    return { job, value };
  } catch (error) {
    await failJob(env, id, error, options);
    throw error;
  }
}

export async function runJob<Value, Result = Value>(
  env: unknown,
  definition: JobDefinition,
  execute: Parameters<typeof executeJob<Value, Result>>[2],
  options: Parameters<typeof executeJob<Value, Result>>[3] = {},
) {
  const job = await createJob(env, definition, options);
  return executeJob<Value, Result>(env, job.id, execute, options);
}

export async function updateJob(
  env: unknown,
  id: unknown,
  patch: JobPatch = {},
  options: JobOptions = {},
): Promise<Job | null> {
  const current = await getJob(env, id, options);
  if (!current) return null;
  const job = await updateJobRow(env, id, current, patch, options);
  if (job) {
    const type = patch.progress !== undefined && patch.status === undefined
      ? "job.progress"
      : `job.${job.status}`;
    await publishJobEvent(env, job, type, options);
  }
  return job;
}
