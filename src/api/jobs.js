import { getJob, listJobEvents, listJobs } from "../core/jobs.js";
import { requestIdentity } from "../core/identity.js";
import { secureJson } from "../core/security.js";

export async function jobResponse(request, env, state) {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/jobs" && !pathname.startsWith("/api/jobs/")) return null;
  if (request.method !== "GET") return secureJson({ error: "Method not allowed" }, 405, { Allow: "GET" });
  const identity = requestIdentity(state);
  const ownerId = identity.authUser?.id || state?.user?.sub || (state?.user?.auth_strategy === "http_basic" ? "basic:admin" : null);
  if (!ownerId) return secureJson({ error: "Authentication is required." }, 401);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/events)?$/);
  const isEvents = url.pathname.endsWith("/events");
  if (!match) {
    const jobs = await listJobs(env, { ownerId, type: url.searchParams.get("type") || undefined, status: url.searchParams.get("status") || undefined, limit: url.searchParams.get("limit") || 50 }, { who: identity.who });
    return secureJson({ jobs });
  }
  const job = await getJob(env, decodeURIComponent(match[1]), { who: identity.who });
  if (!job || (job.ownerId !== ownerId && !identity.isAdmin)) return secureJson({ error: "Job not found" }, 404);
  if (isEvents) return secureJson({ events: await listJobEvents(env, job.id, { who: identity.who }) });
  return secureJson({ job });
}

export async function liveEventsResponse(request, env, state, bindingName = "EVENT_HUB") {
  const url = new URL(request.url);
  if (url.pathname !== "/api/events") return null;
  const identity = requestIdentity(state);
  const ownerId = identity.authUser?.id || state?.user?.sub || (state?.user?.auth_strategy === "http_basic" ? "basic:admin" : null);
  if (!ownerId) return secureJson({ error: "Authentication is required." }, 401);
  const namespace = env?.[bindingName];
  if (!namespace || typeof namespace.idFromName !== "function") return secureJson({ error: "Live events are not configured." }, 501);
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return secureJson({ error: "WebSocket upgrade required." }, 426, { Upgrade: "websocket" });
  const room = `user:${ownerId}`;
  const stub = namespace.get(namespace.idFromName(room));
  return stub.fetch("https://cf-genai-event-hub/connect", { headers: { Upgrade: "websocket" } });
}
