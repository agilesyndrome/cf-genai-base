import { PACKAGE_NAME, VERSION } from "./constants.js";
import { MESSAGING_DATA_RESOURCES } from "./resources.js";
import { MessagingDomain } from "./domain.js";
import type { DataResourceInput } from "../../data/model.js";
import type {
  RuntimeBindings,
  RuntimeFeature,
  RuntimeFeatureOptions,
  RuntimeState,
} from "../../runtime/model.js";

export interface MessagingFeatureOptions<
  Env extends RuntimeBindings = RuntimeBindings,
  State extends RuntimeState = RuntimeState,
> extends RuntimeFeatureOptions<Env, State> {
  dataResources?: readonly DataResourceInput[];
}

export function createMessagingFeature<
  Env extends RuntimeBindings = RuntimeBindings,
  State extends RuntimeState = RuntimeState,
>(options: MessagingFeatureOptions<Env, State> = {}): RuntimeFeature<Env, State> {
  const name = options.name || "messaging";
  const domains = options.domains || [new MessagingDomain({ dataResources: options.dataResources || MESSAGING_DATA_RESOURCES })];
  return {
    name,
    displayName: options.displayName || "Messaging",
    packageName: PACKAGE_NAME,
    version: VERSION,
    domains,
    ...(typeof options.healthcheck === "function" ? { healthcheck: options.healthcheck } : {}),
    healthchecks: options.healthchecks || [],
    circuitBreakers: options.circuitBreakers || [],
    middleware: async (request, env, ctx, next, state) => {
      if (options.boot) await options.boot(env, { request, ctx, state });
      return options.middleware ? options.middleware(request, env, ctx, next, state) : next();
    },
  };
}
