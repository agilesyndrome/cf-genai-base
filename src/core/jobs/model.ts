export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = typeof JOB_STATUSES[number];

export interface JobDefinition {
  id?: string;
  type: string;
  status?: JobStatus;
  ownerId?: string | null;
  tenantId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  input?: unknown;
  progress?: unknown;
  expiresAt?: string | null;
}

export interface Job extends Required<Pick<JobDefinition, "type">> {
  id: string;
  status: JobStatus;
  ownerId: string | null;
  tenantId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  input: unknown;
  result: unknown;
  error: unknown;
  progress: unknown;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
}

export interface JobEvent {
  id: string;
  jobId: string;
  type: string;
  payload: unknown;
  createdAt: string | null;
}

export interface JobRow extends Record<string, unknown> {
  id: string;
  type: string;
  status: string;
  owner_id?: string | null;
  tenant_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  input_json?: string | null;
  result_json?: string | null;
  error_json?: string | null;
  progress_json?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
}

export interface JobEventRow extends Record<string, unknown> {
  id: string;
  job_id: string;
  type: string;
  payload_json?: string | null;
  created_at?: string | null;
}

export interface JobFilters {
  ownerId?: string | null;
  tenantId?: string | null;
  type?: string;
  status?: JobStatus | string;
  resourceType?: string;
  resourceId?: string;
  limit?: number | string;
}

export interface JobOptions {
  who?: string;
  ctx?: ExecutionContext;
}

export interface JobPatch {
  status?: JobStatus | string;
  result?: unknown;
  error?: unknown;
  progress?: unknown;
  startedAt?: string | null;
  finishedAt?: string | null;
  expiresAt?: string | null;
}
