import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import type { IdentityState } from "../../auth/identity/index.js";
import type { D1Environment } from "../database/index.js";
import { secureJson } from "../security/index.js";
import { cancelJob, getJob, listJobEvents, listJobs } from "./service.js";
type Context = DomainRequestContext<D1Environment, IdentityState>;

export class JobsDomain extends AppDomain<unknown, D1Environment, IdentityState> {
  constructor() {
    super({ name: "core.jobs", basePath: "/api/jobs", auth: "user" });
    this.route({ method: "GET", handler: list });
    this.route({ method: "GET", path: "/:jobId", handler: get });
    this.route({ method: "GET", path: "/:jobId/events", handler: events });
    this.route({ method: "POST", path: "/:jobId/cancel", csrf: true, handler: cancel });
  }
}

function owner(context: Context): string {
  return context.state.authUser?.id
    || context.state.user?.sub
    || (context.state.user?.auth_strategy === "http_basic" ? "basic:admin" : "");
}

async function list(context: Context) {
  const url = new URL(context.request.url);
  const jobs = await listJobs(context.env, {
    ...(!(context.identity.isAdmin && url.searchParams.get("all") === "true")
      ? { ownerId: owner(context) }
      : {}),
    ...(context.identity.isAdmin && url.searchParams.get("tenantId")
      ? { tenantId: url.searchParams.get("tenantId") }
      : {}),
    type: url.searchParams.get("type") || undefined,
    status: url.searchParams.get("status") || undefined,
    limit: url.searchParams.get("limit") || 50,
  }, { who: context.identity.who });
  return secureJson({ jobs });
}

async function cancel(context: Context) {
  const job = await ownedJob(context);
  if (!job) return secureJson({ error: "Job not found" }, 404);
  if (!["queued", "running"].includes(job.status)) {
    return secureJson({ error: "Only queued or running jobs can be cancelled" }, 409);
  }
  const cancelled = await cancelJob(context.env, job.id, { who: context.identity.who });
  return secureJson({ job: cancelled });
}

async function ownedJob(context: Context) {
  const job = await getJob(context.env, context.params.jobId, { who: context.identity.who });
  return job && (job.ownerId === owner(context) || context.identity.isAdmin) ? job : null;
}

async function get(context: Context) {
  const job = await ownedJob(context);
  return job ? secureJson({ job }) : secureJson({ error: "Job not found" }, 404);
}

async function events(context: Context) {
  const job = await ownedJob(context);
  if (!job) return secureJson({ error: "Job not found" }, 404);
  const jobEvents = await listJobEvents(context.env, job.id, { who: context.identity.who });
  return secureJson({ events: jobEvents });
}

export const coreJobs = new JobsDomain();
