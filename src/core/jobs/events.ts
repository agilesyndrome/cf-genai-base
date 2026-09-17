import { Event, emitEvent } from "../events/index.js";
import { insertJobEventRow } from "./d1.js";
import type { Job, JobOptions } from "./model.js";

export async function publishJobEvent(
  env: unknown,
  job: Job,
  type: string,
  options: JobOptions = {},
): Promise<void> {
  const payload = {
    jobId: job.id,
    type: job.type,
    status: job.status,
    ownerId: job.ownerId,
    tenantId: job.tenantId,
    resource: job.resourceType && job.resourceId
      ? { type: job.resourceType, id: job.resourceId }
      : null,
    progress: job.progress,
    result: type === "job.succeeded" ? job.result : undefined,
    error: type === "job.failed" ? job.error : undefined,
  };
  const who = options.who ?? "system:update";
  const event = Event(who, type, "job", new Date(), {
    ...payload,
    audience: { userId: job.ownerId, tenantId: job.tenantId },
  });
  await insertJobEventRow(env, { id: event.id, jobId: job.id, type, payload }, options);
  await emitEvent(env, event, options.ctx);
}
