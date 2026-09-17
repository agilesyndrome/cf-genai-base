import { JOB_STATUSES, type JobStatus } from "./model.js";

export function normalizeJobStatus(status: unknown): JobStatus {
  const value = String(status).toLowerCase();
  if (!isJobStatus(value)) throw new TypeError(`Unsupported job status: ${status}`);
  return value;
}

function isJobStatus(value: string): value is JobStatus {
  return JOB_STATUSES.some((status) => status === value);
}

export function requiredJobValue(value: unknown, label: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

export function nullableString(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : String(value);
}

export function encodeJobValue(value: unknown): string {
  return JSON.stringify(value === undefined ? {} : value);
}

export function decodeJobValue(value: unknown): unknown {
  if (value == null || value === "") return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

export function boundedJobLimit(value: unknown, maximum = 100): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0
    ? Math.min(Math.floor(normalized), maximum)
    : Math.min(50, maximum);
}
