import { resolveConfig } from "./config.js";
import { PACKAGE_NAME, VERSION } from "./constants.js";
import { createLLM } from "./client.js";
import type {
  RuntimeBindings,
  RuntimeFeature,
  RuntimeFeatureOptions,
  RuntimeState,
} from "../../runtime/model.js";
import type { LLMClientOptions } from "./model.js";

export interface LLMFeatureOptions<
  Env extends RuntimeBindings = RuntimeBindings,
  State extends RuntimeState = RuntimeState,
> extends RuntimeFeatureOptions<Env, State>, LLMClientOptions<Env> {}

export function createLLMFeature<
  Env extends RuntimeBindings = RuntimeBindings,
  State extends RuntimeState = RuntimeState,
>(options: LLMFeatureOptions<Env, State> = {}): RuntimeFeature<Env, State> {
  const name = options.name || "llm";
  const client = createLLM({ ...options, featureName: name });
  return {
    name,
    displayName: options.displayName || "Language models",
    packageName: PACKAGE_NAME,
    version: VERSION,
    domains: options.domains || [],
    healthcheck: async (env) => {
      try { resolveConfig(options, {}, env); } catch { return [{ feature: name, component: "configuration", displayName: "LLM configuration", state: "red" }]; }
      try {
        await client.listModels({ env, who: "system:update" });
        return [{ feature: name, component: "configuration", displayName: "LLM configuration", state: "green" }];
      } catch {
        return [{ feature: name, component: "configuration", displayName: "LLM configuration", state: "yellow" }];
      }
    },
    healthchecks: options.healthchecks || [{ feature: name, component: "llm-models", displayName: "LLM model availability", state: "yellow" }],
    circuitBreakers: options.circuitBreakers || [{ id: name + ":llm-models", feature: name, name: "llm-models", displayName: "LLM model access", state: "on", allowSelfHealing: true, healthchecks: [name + ":llm-models"] }],
    middleware: async (request, env, ctx, next, state) => {
      if (options.boot) await options.boot(env, { request, ctx, state });
      return options.middleware ? options.middleware(request, env, ctx, next, state) : next();
    },
  };
}
