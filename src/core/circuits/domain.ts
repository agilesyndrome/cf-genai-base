import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import { badRequest, notFound, readJsonObject, stringField } from "../../api/http.js";
import type { D1Environment } from "../database/index.js";
import { getCircuitBreaker, listCircuitBreakers, setCircuitBreaker } from "./service.js";
type Context = DomainRequestContext<D1Environment, unknown>;

export class CircuitBreakersDomain extends AppDomain<unknown, D1Environment, unknown> {
  constructor() {
    super({ name: "core.circuit-breakers", basePath: "/api/admin/circuit-breakers", auth: "user", scopes: "operations:read" });
    this.route({
      method: "GET",
      handler: ({ env, identity }) =>
        listCircuitBreakers(env, { who: identity.who }).then((circuitBreakers) =>
          Response.json({ circuit_breakers: circuitBreakers }),
        ),
    });
    this.route({ method: "GET", path: "/:circuitId", handler: get });
    this.route({ method: "PUT", path: "/:circuitId", csrf: true, scopes: "operations:manage", handler: set });
  }
}

async function get({ env, identity, params }: Context) {
  const circuit = await getCircuitBreaker(env, params.circuitId, { who: identity.who });
  return circuit
    ? Response.json({ circuit_breaker: circuit })
    : notFound("Circuit breaker not found");
}

async function set({ request, env, identity, params }: Context) {
  try {
    const state = stringField(await readJsonObject(request), "state");
    if (!state) return badRequest("state is required");
    const circuit = await setCircuitBreaker(env, params.circuitId, state, { who: identity.who });
    return circuit
      ? Response.json({ circuit_breaker: circuit })
      : notFound("Circuit breaker not found");
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid circuit breaker state");
  }
}

export const coreCircuitBreakers = new CircuitBreakersDomain();
