import { AppDomain, type DomainRequestContext } from "../domain/index.js";
import { listFeatureHealth } from "../core/healthchecks/index.js";
import { healthResponse } from "./health.js";
import type { HealthProvider, RuntimeBindings, RuntimeState } from "./model.js";

type RuntimeContext = DomainRequestContext<RuntimeBindings, RuntimeState>;

/** Public operational health belongs to a domain even though it has no D1 model. */
export class RuntimeHealthDomain extends AppDomain<unknown, RuntimeBindings, RuntimeState> {
  constructor(health?: HealthProvider) {
    super({ name: "runtime.health", basePath: "/health" });
    const handler = (context: RuntimeContext) => respondWithHealth(context, health);
    this.route({ method: "GET", handler });
    this.route({ method: "GET", absolutePath: "/api/health", handler });
  }
}

async function respondWithHealth(context: RuntimeContext, health?: HealthProvider) {
  const details = health ? await health(context.env, context) : {};
  const features = context.env?.DB
    ? await listFeatureHealth(context.env, { who: "system:read" }).catch(() => [])
    : [];
  return healthResponse(context.env, features.length ? { ...details, features } : details);
}

/** Exposes the current user's available tenant context; it is not an admin API. */
export class TenantContextDomain extends AppDomain<unknown, RuntimeBindings, RuntimeState> {
  constructor() {
    super({ name: "auth.tenant-context", basePath: "/api/tenant", auth: "user" });
    this.route({ method: "GET", handler: tenantContext });
  }
}

async function tenantContext({ state }: RuntimeContext) {
  if (!state.data) return Response.json({ error: "Data context is unavailable." }, { status: 500 });
  const context = await state.data.context();
  if (context.invalidTenant) {
    return Response.json({ error: "The requested tenant is not available." }, { status: 400 });
  }
  const tenant = context.tenantId
    ? { id: context.tenantId, name: context.tenants?.find((candidate) => candidate.id === context.tenantId)?.name ?? null }
    : null;
  return Response.json({ tenant, tenants: context.tenants ?? [] });
}

export function createRuntimeDomains(options: { health?: HealthProvider } = {}) {
  return [new RuntimeHealthDomain(options.health), new TenantContextDomain()] as const;
}
