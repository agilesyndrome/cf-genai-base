import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import { badRequest, notFound, readJsonObject, stringField } from "../../api/http.js";
import { listFeatureCatalog, listFeatureHealth } from "./features.js";
import { getHealthcheck, listHealthchecks, updateHealthcheck } from "./service.js";
import type { HealthcheckEnvironment } from "./model.js";
type Context = DomainRequestContext<HealthcheckEnvironment, unknown>;

export class HealthchecksDomain extends AppDomain<unknown, HealthcheckEnvironment, unknown> {
  constructor() {
    super({ name: "core.healthchecks", basePath: "/api/admin", auth: "user", scopes: "operations:read" });
    this.route({
      method: "GET",
      path: "/status",
      handler: ({ env, identity }) =>
        listFeatureHealth(env, { who: identity.who }).then((features) => Response.json({ features })),
    });
    this.route({
      method: "GET",
      path: "/features",
      handler: ({ env, identity }) =>
        listFeatureCatalog(env, [...(env.features ?? [])], { who: identity.who }).then((features) =>
          Response.json({ features }),
        ),
    });
    this.route({
      method: "GET",
      path: "/healthchecks",
      handler: ({ env, identity }) =>
        listHealthchecks(env, { who: identity.who }).then((healthchecks) =>
          Response.json({ healthchecks }),
        ),
    });
    this.route({ method: "PUT", path: "/healthchecks/:healthcheckId", csrf: true, scopes: "operations:manage", handler: setHealthcheck });
    this.route({ method: "GET", path: "/healthchecks/:healthcheckId", handler: getHealthcheckDetail });
  }
}

async function getHealthcheckDetail({ env, identity, params }: Context) {
  const healthcheck = await getHealthcheck(env, params.healthcheckId, { who: identity.who });
  return healthcheck ? Response.json({ healthcheck }) : notFound("Healthcheck not found");
}

async function setHealthcheck({ request, env, identity, params }: Context) {
  try {
    const state = stringField(await readJsonObject(request), "state");
    if (!state) return badRequest("state is required");
    const healthcheck = await updateHealthcheck(env, params.healthcheckId, state, {
      who: identity.who,
    });
    return healthcheck ? Response.json({ healthcheck }) : notFound("Healthcheck not found");
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid healthcheck state");
  }
}

export const coreHealthchecks = new HealthchecksDomain();
