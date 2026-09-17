import { DEFAULT_ENDPOINT, DEFAULT_MODEL } from "./constants.js";
import { LLMResponseError } from "./errors.js";
import type {
  LLMClientOptions,
  LLMConfigValue,
  LLMEnvironment,
  LLMHeaders,
  LLMRequestOptions,
  LLMResolvedProviderConfig,
} from "./model.js";

export function resolveConfig<Env extends LLMEnvironment>(
  options: LLMClientOptions<Env>,
  requestOptions: LLMRequestOptions<Env>,
  env: Env | undefined,
): LLMResolvedProviderConfig {
  if (requestOptions.apiUrl !== undefined && options.allowDynamicApiUrl !== true) {
    throw new Error("Per-request LLM API URLs are disabled; configure apiUrl at client creation time.");
  }
  const apiUrl = (options.allowDynamicApiUrl === true ? requestOptions.apiUrl : undefined)
    || resolveValue(options.apiUrl, env)
    || env?.LLM_API_URL
    || DEFAULT_ENDPOINT;
  const url = parseApiUrl(apiUrl);
  if (url.protocol !== "https:") throw new Error("LLM_API_URL must use HTTPS");
  const token = requestOptions.apiToken || resolveValue(options.apiToken, env) || env?.LLM_API_TOKEN;
  if (typeof token !== "string" || token.length === 0) throw new Error("LLM_API_TOKEN is not configured");
  const model = requestOptions.model || resolveValue(options.model, env) || env?.LLM_MODEL || DEFAULT_MODEL;
  if (typeof model !== "string" || model.length === 0) throw new Error("LLM_MODEL must be a non-empty string");
  const endpoint = endpointFor(apiUrl, "responses");
  const modelsEndpoint = endpointFor(apiUrl, "models");
  const gateway = isCloudflareGateway(url);
  const headers: LLMHeaders = {
    "Content-Type": "application/json",
    ...resolveValue(options.headers, env),
    ...requestOptions.headers,
  };
  if (gateway) headers["cf-aig-authorization"] = `Bearer ${token}`;
  else headers.Authorization = `Bearer ${token}`;
  return {
    provider: gateway ? "cloudflare-ai-gateway" : "openai-compatible",
    gateway,
    endpoint,
    modelsEndpoint,
    model,
    headers,
  };
}

export async function resolveModel(
  config: LLMResolvedProviderConfig,
  fetcher: typeof fetch,
  requestOptions: Pick<LLMRequestOptions, "signal">,
): Promise<string> {
  if (config.model !== "auto") return config.model;
  const response = await fetcher(config.modelsEndpoint, {
    method: "GET",
    headers: config.headers,
    signal: requestOptions.signal,
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new LLMResponseError("Automatic model selection failed", payload);
  const models = validateModelList(payload, "Automatic model selection failed");
  if (!models[0]) throw new LLMResponseError("Automatic model selection failed", payload);
  return models[0].id;
}

export function validateModelList(payload: unknown, message: string): Array<Record<string, unknown> & { id: string }> {
  if (!isRecord(payload) || !Array.isArray(payload.data)) throw new LLMResponseError(message, payload);
  const models: Array<Record<string, unknown> & { id: string }> = [];
  for (const model of payload.data) {
    if (!isRecord(model) || typeof model.id !== "string" || model.id.length === 0) {
      throw new LLMResponseError(message, payload);
    }
    models.push({ ...model, id: model.id });
  }
  return models;
}

function resolveValue<Value, Env extends LLMEnvironment>(
  value: LLMConfigValue<Value, Env> | undefined,
  env: Env | undefined,
): Value | undefined {
  if (typeof value === "function") {
    const resolver = value as (env: Env | undefined) => Value | undefined;
    return resolver(env);
  }
  return value;
}

function parseApiUrl(apiUrl: string): URL {
  try { return new URL(apiUrl); } catch { throw new Error("LLM_API_URL must be a valid URL"); }
}

function endpointFor(baseUrl: string, resource: "responses" | "models"): string {
  return String(baseUrl).replace(/\/+$/, "").replace(/\/(responses|models)$/, "") + "/" + resource;
}

function isCloudflareGateway(url: URL): boolean {
  return url.hostname === "gateway.ai.cloudflare.com";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
