import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiJson, type JsonValue } from "../../api/client.js";
import { ResourceState, StatusBadge } from "./foundation.js";
import { useLiveEvent, useLiveEvents } from "./live-events.js";

export interface Job {
  id: string;
  type: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  progress?: JsonValue;
  result?: JsonValue;
  error?: JsonValue;
}
export interface JobEvent { id: string; type: string; createdAt?: string }
export interface JobFilters { [key: string]: string | number | boolean | null | undefined }
export interface JobsResource { jobs: Job[]; loading: boolean; error: unknown; reload: () => Promise<void> }
export interface JobResource { job: Job | null; loading: boolean; error: unknown; reload: () => Promise<Job | null> }

function jobQuery(filters: JobFilters): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  return query.toString() ? `/api/jobs?${query}` : "/api/jobs";
}

export function useJobs(filters: JobFilters = {}): JobsResource {
  const key = useMemo(() => JSON.stringify(filters), [filters]);
  const path = useMemo(() => jobQuery(parseJobFilters(key)), [key]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const { connection } = useLiveEvents();
  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await apiFetch(path, { validateJson: isJobsResponse });
      setJobs(result instanceof Response ? [] : result.jobs);
      setError(null);
    } catch (cause: unknown) { setError(cause); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (connection === "open") void reload(); }, [connection, reload]);
  useLiveEvent((event) => event.what.startsWith("job."), () => { void reload(); });
  return { jobs, loading, error, reload };
}

export function useJob(jobId: string | null | undefined): JobResource {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async (): Promise<Job | null> => {
    if (!jobId) return null;
    setLoading(true);
    try {
      const result = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`, { validateJson: isJobResponse });
      const next = result instanceof Response ? null : result.job;
      setJob(next); setError(null); return next;
    } catch (cause: unknown) { setError(cause); throw cause; }
    finally { setLoading(false); }
  }, [jobId]);
  useEffect(() => { void reload().catch(() => undefined); }, [reload]);
  useLiveEvent((event) => event.details.jobId === jobId, () => { void reload().catch(() => undefined); });
  return { job, loading, error, reload };
}

export interface JobNotificationsOptions { limit?: number }
export function useJobNotifications({ limit = 20 }: JobNotificationsOptions = {}) {
  const { jobs, loading, error, reload } = useJobs({ limit });
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const notifications = jobs.filter((job) => ["succeeded", "failed", "cancelled"].includes(job.status) && !dismissed.has(job.id));
  const dismiss = useCallback((jobId: string) => setDismissed((current) => new Set([...current, jobId])), []);
  return { notifications, loading, error, dismiss, reload };
}

export interface JobNotificationBannerProps { job: Job; onDismiss?: (jobId: string) => void }
export function JobNotificationBanner({ job, onDismiss }: JobNotificationBannerProps) {
  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";
  const message = failed ? `${job.type} failed.` : cancelled ? `${job.type} was cancelled.` : `${job.type} finished.`;
  return <aside className={`cf-ui-job-banner cf-ui-job-${job.status}`} role="status" aria-live="polite"><span>{message}</span><button type="button" onClick={() => onDismiss?.(job.id)} aria-label="Dismiss notification">Dismiss</button></aside>;
}

export interface JobNotificationListProps { notifications: readonly Job[]; onDismiss?: (jobId: string) => void }
export function JobNotificationList({ notifications, onDismiss }: JobNotificationListProps) { return <>{notifications.map((job) => <JobNotificationBanner key={job.id} job={job} onDismiss={onDismiss} />)}</>; }

export interface JobListProps { filters?: JobFilters }
export function JobList({ filters = {} }: JobListProps) {
  const resource = useJobs(filters);
  return <section className="cf-ui-card"><h1>Jobs</h1><ResourceState {...resource} empty="No jobs found.">{resource.jobs.length ? <div className="cf-ui-table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Updated</th></tr></thead><tbody>{resource.jobs.map((job) => <tr key={job.id}><th scope="row"><a href={`/admin/jobs/${encodeURIComponent(job.id)}`}>{job.type}</a><small>{job.id}</small></th><td><StatusBadge state={job.status} /></td><td>{job.updatedAt || job.createdAt || "—"}</td></tr>)}</tbody></table></div> : null}</ResourceState></section>;
}

export interface JobDetailProps { jobId: string }
export function JobDetail({ jobId }: JobDetailProps) {
  const resource = useJob(jobId);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const reloadEvents = useCallback(async (): Promise<void> => {
    if (!jobId) return;
    const result = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/events`, { validateJson: isJobEventsResponse });
    setEvents(result instanceof Response ? [] : result.events);
  }, [jobId]);
  useEffect(() => { void reloadEvents().catch(() => undefined); }, [reloadEvents, resource.job?.updatedAt]);
  const cancel = async (): Promise<void> => { await apiJson(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {}, { method: "POST" }); await resource.reload(); };
  const job = resource.job;
  return <section className="cf-ui-card"><ResourceState {...resource} empty="Job not found.">{job ? <><header><h1>{job.type}</h1><StatusBadge state={job.status} /><small>{job.id}</small></header>{["queued", "running"].includes(job.status) ? <button type="button" onClick={cancel}>Cancel job</button> : null}<h2>Progress</h2><pre>{JSON.stringify(job.progress, null, 2)}</pre><h2>Result</h2><pre>{JSON.stringify(job.result, null, 2)}</pre>{job.error ? <><h2>Error</h2><pre>{JSON.stringify(job.error, null, 2)}</pre></> : null}<h2>Events</h2>{events.length ? <ol>{events.map((event) => <li key={event.id}><strong>{event.type}</strong> <small>{event.createdAt}</small></li>)}</ol> : <p>No events.</p>}</> : null}</ResourceState></section>;
}

interface JobsResponse { jobs: Job[] }
interface JobResponse { job: Job }
interface JobEventsResponse { events: JobEvent[] }
function isJobsResponse(value: unknown): value is JobsResponse { if (!isObject(value)) return false; const jobs: unknown = Reflect.get(value, "jobs"); return Array.isArray(jobs) && jobs.every(isJob); }
function isJobResponse(value: unknown): value is JobResponse { return isObject(value) && isJob(Reflect.get(value, "job")); }
function isJobEventsResponse(value: unknown): value is JobEventsResponse { if (!isObject(value)) return false; const events: unknown = Reflect.get(value, "events"); return Array.isArray(events) && events.every(isJobEvent); }
function isJob(value: unknown): value is Job { return isObject(value) && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "type") === "string" && typeof Reflect.get(value, "status") === "string" && optionalString(value, "createdAt") && optionalString(value, "updatedAt") && optionalJson(value, "progress") && optionalJson(value, "result") && optionalJson(value, "error"); }
function isJobEvent(value: unknown): value is JobEvent { return isObject(value) && typeof Reflect.get(value, "id") === "string" && typeof Reflect.get(value, "type") === "string" && optionalString(value, "createdAt"); }
function isObject(value: unknown): value is object { return value !== null && typeof value === "object" && !Array.isArray(value); }
function optionalString(value: object, key: string): boolean { const field: unknown = Reflect.get(value, key); return field === undefined || typeof field === "string"; }
function optionalJson(value: object, key: string): boolean { const field: unknown = Reflect.get(value, key); return field === undefined || isJsonValue(field); }
function isJsonValue(value: unknown): value is JsonValue { if (value === null || typeof value === "string" || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (Array.isArray(value)) return value.every(isJsonValue); return typeof value === "object" && Object.values(value).every(isJsonValue); }
function parseJobFilters(value: string): JobFilters { const parsed: unknown = JSON.parse(value); if (!isObject(parsed)) return {}; const result: JobFilters = {}; for (const [key, item] of Object.entries(parsed)) if (item === null || ["string", "number", "boolean"].includes(typeof item)) result[key] = item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? item : undefined; return result; }
