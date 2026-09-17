import type { D1Environment } from "../database/index.js";
import { auditLog } from "../events/index.js";
import {
  readCircuitBreaker,
  readCircuitBreakerIds,
  readDependencyStates,
  readHealthcheckStates,
  saveCircuitBreaker,
  writeCircuitBreakerState,
} from "./d1.js";
import type {
  CircuitAccessOptions,
  CircuitBreaker,
  CircuitBreakerInput,
  CircuitUpdateOptions,
} from "./model.js";
import { circuitBreakerState, normalizeCircuitBreaker } from "./validation.js";

export async function registerCircuitBreaker(
  env: D1Environment,
  input: CircuitBreakerInput,
  options: CircuitAccessOptions = {},
): Promise<CircuitBreaker | null> {
  const item = normalizeCircuitBreaker(input);
  const id = String(input.id || `${item.feature}:${item.name}`);
  await saveCircuitBreaker(env, id, item, options);
  return getCircuitBreaker(env, id, options);
}

export const getCircuitBreaker = readCircuitBreaker;

export async function listCircuitBreakers(
  env: D1Environment,
  options: CircuitAccessOptions = {},
): Promise<CircuitBreaker[]> {
  const ids = await readCircuitBreakerIds(env, options);
  const breakers = await Promise.all(ids.map((id) => getCircuitBreaker(env, id, options)));
  return breakers.filter((breaker): breaker is CircuitBreaker => breaker !== null);
}

export async function setCircuitBreaker(
  env: D1Environment,
  id: string,
  state: unknown,
  { who = "system:read", automated = false }: CircuitUpdateOptions = {},
): Promise<CircuitBreaker | null> {
  const next = circuitBreakerState(state);
  const current = await getCircuitBreaker(env, id, { who });
  if (!current) return null;

  const mayHeal = current.state === "tripped" && next === "on" && Boolean(current.allow_self_healing);
  const mayTrip = current.state === "on" && next === "tripped";
  if (automated && !(mayTrip || mayHeal)) return current;
  if (automated && next === "off") return current;

  await writeCircuitBreakerState(env, id, next, { who });
  auditLog({
    who,
    operation: "update",
    resource: `feature:${current.feature} circuit_breaker:${current.name} ${next}`,
  });
  return getCircuitBreaker(env, id, { who });
}

export async function evaluateCircuitBreaker(
  env: D1Environment,
  id: string,
  { who = "system:read" }: CircuitAccessOptions = {},
): Promise<CircuitBreaker | null> {
  const breaker = await getCircuitBreaker(env, id, { who });
  if (!breaker) return null;

  const [healthcheckStates, dependencyStates] = await Promise.all([
    readHealthcheckStates(env, id, { who }),
    readDependencyStates(env, id, { who }),
  ]);
  const failing = healthcheckStates.map((state) => state === "red");
  const dependencyFailed = dependencyStates.some((state) => state === "tripped");
  const healthcheckFailed = failing.length > 0 &&
    (breaker.healthcheck_mode === "all" ? failing.every(Boolean) : failing.some(Boolean));
  const shouldTrip = dependencyFailed || healthcheckFailed;

  if (breaker.state === "on" && shouldTrip) {
    return setCircuitBreaker(env, id, "tripped", { who, automated: true });
  }
  if (breaker.state === "tripped" && !shouldTrip && breaker.allow_self_healing) {
    return setCircuitBreaker(env, id, "on", { who, automated: true });
  }
  return breaker;
}
