import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/client.js";
import { useLiveEvent, useLiveEvents } from "./live-events.jsx";

function jobQuery(filters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters || {})) if (value !== undefined && value !== null && value !== "") query.set(key, value);
  return query.toString() ? `/api/jobs?${query}` : "/api/jobs";
}

export function useJobs(filters = {}) {
  const key = useMemo(() => JSON.stringify(filters), [filters]);
  const path = useMemo(() => jobQuery(JSON.parse(key)), [key]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { connection } = useLiveEvents();
  const reload = useCallback(async () => {
    setLoading(true);
    try { const result = await apiFetch(path); setJobs(result.jobs || []); setError(null); }
    catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (connection === "open") reload(); }, [connection, reload]);
  useLiveEvent((event) => String(event.what || "").startsWith("job."), reload);
  return { jobs, loading, error, reload };
}

export function useJob(jobId) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    if (!jobId) return null;
    setLoading(true);
    try { const result = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}`); setJob(result.job); setError(null); return result.job; }
    catch (cause) { setError(cause); throw cause; }
    finally { setLoading(false); }
  }, [jobId]);
  useEffect(() => { reload().catch(() => {}); }, [reload]);
  useLiveEvent((event) => event.details?.jobId === jobId, () => { reload().catch(() => {}); });
  return { job, loading, error, reload };
}

export function useJobNotifications({ limit = 20 } = {}) {
  const { jobs, loading, error, reload } = useJobs({ limit });
  const [dismissed, setDismissed] = useState(() => new Set());
  const notifications = jobs.filter((job) => ["succeeded", "failed", "cancelled"].includes(job.status) && !dismissed.has(job.id));
  const dismiss = useCallback((jobId) => setDismissed((current) => new Set([...current, jobId])), []);
  return { notifications, loading, error, dismiss, reload };
}

export function JobNotificationBanner({ job, onDismiss }) {
  const failed = job.status === "failed";
  const cancelled = job.status === "cancelled";
  const message = failed ? `${job.type} failed.` : cancelled ? `${job.type} was cancelled.` : `${job.type} finished.`;
  return <aside className={`cf-ui-job-banner cf-ui-job-${job.status}`} role="status" aria-live="polite"><span>{message}</span><button type="button" onClick={() => onDismiss?.(job.id)} aria-label="Dismiss notification">Dismiss</button></aside>;
}

export function JobNotificationList({ notifications, onDismiss }) {
  return <>{notifications.map((job) => <JobNotificationBanner key={job.id} job={job} onDismiss={onDismiss} />)}</>;
}
