import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import { createD1, type D1Environment } from "../database/index.js";
import { parseAuditDetails, type AuditLogRecord } from "./index.js";

type Context = DomainRequestContext<D1Environment, unknown>;

export class AuditLogDomain extends AppDomain<AuditLogRecord, D1Environment, unknown> {
  constructor() {
    super({ name: "core.audit-log", basePath: "/api/admin/audit-log", auth: "user", scopes: "operations:read" });
    this.route({ method: "GET", handler: list });
  }
}

async function list({ request, env, identity }: Context): Promise<Response> {
  const url = new URL(request.url);
  const params: string[] = [];
  const where: string[] = ["created_at >= datetime('now','-30 days')"];
  for (const [key, column] of [["who", "who"], ["operation", "operation"], ["resource", "resource"]] as const) {
    const value = url.searchParams.get(key)?.trim();
    if (value) { where.push(`${column} LIKE ?`); params.push(`%${value}%`); }
  }
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
  const result = await createD1(env, { who: identity.who }).prepare(
    `SELECT id,who,operation,resource,details_json,created_at FROM core_audit_log WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all<{ id: string; who: string; operation: string; resource: string; details_json: string; created_at: string }>();
  return Response.json({ audit: (result.results ?? []).map((row) => ({ ...row, details: parseAuditDetails(JSON.parse(row.details_json || "{}")) })) });
}

export const coreAuditLog = new AuditLogDomain();
