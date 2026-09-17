import { BASE_PACKAGE_NAME, BASE_VERSION } from "../constants.js";
import { auditLog, eventLog } from "../events/index.js";
import { secureJson } from "../security/index.js";
import type { CircuitBreaker } from "./model.js";
import { getCircuitBreaker } from "./service.js";

interface EventEnvironment {
  DB?: D1Database;
  event?: (what: string, where: string, details: Record<string, unknown>) => unknown;
}

interface RequiredCircuit {
  feature: string;
  breakerId: string;
  operation?: string;
  requestId?: string;
  who?: string;
  message?: string;
}

interface AvailabilityFeatureOptions {
  name?: string;
  breakerId?: string;
  displayName?: string;
  publicPaths?: readonly string[];
}

export async function featureCircuit(
  env: EventEnvironment,
  id: string,
  who = "system:read",
): Promise<CircuitBreaker | null> {
  return getCircuitBreaker(env, id, { who }).catch((error: unknown) => {
    const problem = error instanceof Error ? error : new Error(String(error));
    eventLog("error", "feature.circuit.read.failed", {
      breaker: id,
      errorName: problem.name,
      errorMessage: problem.message.slice(0, 300),
    });
    void env.event?.("feature.circuit.read.failed", "feature", {
      breaker: id,
      who,
      errorName: problem.name,
    });
    return null;
  });
}

export async function featureAvailable(
  env: EventEnvironment,
  id: string,
  who = "system:read",
): Promise<boolean> {
  return (await featureCircuit(env, id, who))?.state === "on";
}

export async function requireFeatureCircuit(
  env: EventEnvironment,
  {
    feature,
    breakerId,
    operation,
    requestId,
    who,
    message = "The requested feature is unavailable.",
  }: RequiredCircuit,
): Promise<CircuitBreaker> {
  const actor = who || "system:read";
  const breaker = await featureCircuit(env, breakerId, actor);
  if (breaker?.state === "on") return breaker;

  const details = {
    feature,
    breaker: breakerId,
    state: breaker?.state || "missing",
    operation,
    requestId: requestId || null,
  };
  eventLog("warn", "feature.request.blocked", details);
  auditLog({ who: actor, operation: "blocked", resource: `feature:${feature}`, details });
  await env.event?.("feature.request.blocked", "feature", { ...details, who: actor });

  throw Object.assign(new Error(message), {
    status: 503,
    code: "feature_circuit_unavailable",
    feature,
    breakerId,
    circuitState: breaker?.state || "missing",
  });
}

export function createAvailabilityFeature({
  name = "base",
  breakerId = `${name}:site-available`,
  displayName = "Site availability",
  publicPaths = ["/health", "/api/health"],
}: AvailabilityFeatureOptions = {}) {
  return {
    name,
    packageName: BASE_PACKAGE_NAME,
    version: BASE_VERSION,
    healthcheck: async () => ({
      feature: name,
      component: "site-available",
      displayName,
      state: "green",
      metadata: { endpoint: "/health", expectedStatus: 200 },
    }),
    circuitBreakers: [{
      id: breakerId,
      name: "site-available",
      displayName,
      state: "on",
      allowSelfHealing: false,
      healthchecks: [`${name}:site-available`],
    }],
    // This is policy middleware: Hono still owns routing and middleware composition.
    async middleware(
      request: Request,
      env: EventEnvironment,
      _ctx: unknown,
      next: (request: Request) => Response | Promise<Response>,
    ): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
        return next(request);
      }

      const breaker = await featureCircuit(env, breakerId, "system:read");
      if (breaker?.state === "on") return next(request);

      await env.event?.("feature.maintenance", "availability", {
        feature: name,
        breaker: breakerId,
        state: breaker?.state || "missing",
        pathname,
        method: request.method,
      });
      return secureJson({ error: "The site is temporarily unavailable." }, 503);
    },
  };
}

