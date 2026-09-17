import { getCircuitBreaker, registerCircuitBreaker, setCircuitBreaker } from "../../core/circuits/index.js";
import { registerHealthcheck } from "../../core/healthchecks/index.js";
import { executeJob } from "../../core/jobs/index.js";
import { resolveConfig, resolveModel, validateModelList } from "./config.js";
import { LLMCircuitBreakerError, LLMResponseError } from "./errors.js";
import { parseBestEffort, validateAndReturn } from "./schema.js";
import type {
  JSONSchemaInput,
  LLMClient,
  LLMClientOptions,
  LLMEnvironment,
  LLMGenerationResult,
  LLMJobGenerationOptions,
  LLMMetadata,
  LLMMultiGenerationInput,
  LLMProviderRequestResult,
  LLMRequestOptions,
  LLMReviewInput,
  LLMTokenUsage,
} from "./model.js";

type LogLevel = "debug" | "info" | "error";

interface ProviderResponsePayload extends Record<string, unknown> {
  output_text?: string;
  output?: ProviderOutputItem[];
  usage?: ProviderUsage;
}

interface ProviderOutputItem extends Record<string, unknown> {
  content?: ProviderContentItem[];
}

interface ProviderContentItem extends Record<string, unknown> {
  type?: string;
  text?: string;
}

interface ProviderUsage extends Record<string, unknown> {
  input_tokens?: number;
  prompt_tokens?: number;
  output_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export function createLLM<Env extends LLMEnvironment = LLMEnvironment>(
  options: LLMClientOptions<Env> = {},
): LLMClient<Env> {
  for (const removed of ["feature", "apiKey"]) {
    if (Object.hasOwn(options, removed)) throw new TypeError(`createLLM.${removed} was removed in v5.0.3`);
  }
  const fetcher = options.fetch || globalThis.fetch;
  const logger = options.logger || console;
  const defaults = options.metadata || {};
  const debugLogging = options.debugLogging === true;
  const featureName = options.featureName || "llm";
  const breakerId = options.breakerId || featureName + ":llm-models";
  const healthcheckId = options.healthcheckId || featureName + ":llm-models";
  if (typeof fetcher !== "function") throw new TypeError("createLLM requires fetch");

  const log = (level: LogLevel, event: Record<string, unknown>): void => {
    if (level === "debug" && !debugLogging) return;
    try {
      const writer = logger[level] || logger.info || (() => {});
      writer.call(logger, JSON.stringify({ source: "cf-genai-base/llm", ...event }));
    } catch { /* logging cannot break a request */ }
  };

  async function assertAvailable(requestOptions: LLMRequestOptions<Env> = {}): Promise<void> {
    const env = requestOptions.env || options.env;
    if (!env?.DB || requestOptions.allowWhenCircuitTripped) return;
    const breaker = await getCircuitBreaker(env, breakerId, { who: requestOptions.who || "system:read" }).catch(() => null);
    if (breaker && breaker.state !== "on") throw new LLMCircuitBreakerError();
  }

  async function listModels(requestOptions: LLMRequestOptions<Env> = {}): Promise<Record<string, unknown>[]> {
    const env = requestOptions.env || options.env;
    const config = resolveConfig(options, requestOptions, env);
    try {
      const response = await fetcher(config.modelsEndpoint, {
        method: "GET",
        headers: config.headers,
        signal: requestOptions.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok) throw new LLMResponseError("LLM model list failed (" + response.status + ")", payload);
      const models = validateModelList(payload, "LLM model list returned a malformed response");
      if (env?.DB) {
        await registerHealthcheck(env, {
          id: healthcheckId,
          feature: featureName,
          component: "llm-models",
          displayName: "LLM model availability",
          state: "green",
          metadata: { provider: config.provider, gateway: config.gateway, count: models.length },
        }, { who: requestOptions.who || "system:update" });
        await registerCircuitBreaker(env, {
          id: breakerId,
          feature: featureName,
          name: "llm-models",
          displayName: "LLM model access",
          state: "on",
          allowSelfHealing: true,
          healthchecks: [healthcheckId],
        }, { who: requestOptions.who || "system:update" });
        await setCircuitBreaker(env, breakerId, "on", {
          who: requestOptions.who || "system:update",
          automated: true,
        }).catch(() => {});
      }
      return models;
    } catch (error) {
      if (env?.DB) {
        await registerHealthcheck(env, {
          id: healthcheckId,
          feature: featureName,
          component: "llm-models",
          displayName: "LLM model availability",
          state: "red",
          metadata: { provider: config.provider, gateway: config.gateway, error: errorMessage(error) },
        }, { who: requestOptions.who || "system:update" }).catch(() => {});
        await registerCircuitBreaker(env, {
          id: breakerId,
          feature: featureName,
          name: "llm-models",
          displayName: "LLM model access",
          state: "on",
          allowSelfHealing: true,
          healthchecks: [healthcheckId],
        }, { who: requestOptions.who || "system:update" })
          .then(() => setCircuitBreaker(env, breakerId, "tripped", {
            who: requestOptions.who || "system:update",
            automated: true,
          }))
          .catch(() => {});
      }
      throw error;
    }
  }

  async function request(
    prompt: string,
    schema: JSONSchemaInput | undefined,
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMProviderRequestResult> {
    await assertAvailable(requestOptions);
    const started = Date.now();
    const requestId = requestOptions.requestId || crypto.randomUUID();
    const env = requestOptions.env || options.env;
    const config = resolveConfig(options, requestOptions, env);
    const metadata: LLMMetadata = { ...defaults, ...(requestOptions.metadata || {}) };
    const model = await resolveModel(config, fetcher, requestOptions);
    const body: Record<string, unknown> = { model, input: prompt, store: false };
    if (Object.keys(metadata).length) body.metadata = metadata;
    if (schema) {
      body.text = {
        format: {
          type: "json_schema",
          name: requestOptions.schemaName || "response",
          strict: true,
          schema,
        },
      };
    }
    log("debug", {
      event: "llm.request",
      requestId,
      metadata,
      provider: config.provider,
      gateway: config.gateway,
      model: body.model,
      hasSchema: Boolean(schema),
    });
    let response: Response;
    let payload: unknown;
    try {
      response = await fetcher(config.endpoint, {
        method: "POST",
        headers: config.headers,
        body: JSON.stringify(body),
        signal: requestOptions.signal,
      });
      payload = await response.json() as unknown;
    } catch (error) {
      log("error", {
        event: "llm.error",
        requestId,
        durationMs: Date.now() - started,
        error: errorMessage(error),
        provider: config.provider,
        gateway: config.gateway,
        model: body.model,
      });
      throw error;
    }
    const usage = normalizeUsageFromPayload(payload);
    if (requestOptions.onUsage) await requestOptions.onUsage(usage);
    log(response.ok ? "info" : "error", {
      event: "llm.response",
      requestId,
      status: response.status,
      durationMs: Date.now() - started,
      usage,
      metadata,
      provider: config.provider,
      gateway: config.gateway,
      model: body.model,
    });
    if (!response.ok) throw new LLMResponseError(`LLM request failed (${response.status})`, payload);
    const providerPayload = validateProviderResponse(payload);
    const text = extractText(providerPayload);
    if (!text) throw new LLMResponseError("LLM returned no text", payload);
    if (requestOptions.onText) await requestOptions.onText(text);
    return { text, payload: providerPayload, usage, requestId, metadata };
  }

  async function generate<const Schema extends JSONSchemaInput | undefined = undefined>(
    prompt: string,
    schema?: Schema,
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMGenerationResult<Schema>> {
    if (typeof prompt !== "string") throw new TypeError("generate prompt must be a string");
    if (Object.hasOwn(requestOptions, "apiKey")) throw new TypeError("generate apiKey was removed in v5.0.3");
    const first = await request(prompt, schema, requestOptions);
    if (!schema) return parseBestEffort(first.text) as LLMGenerationResult<Schema>;
    try {
      return validateAndReturn(first.text, schema) as LLMGenerationResult<Schema>;
    } catch (error) {
      const repairPrompt = `${prompt}\n\nYour previous response was invalid for the required schema. Return only corrected JSON matching this schema exactly.\nSchema: ${JSON.stringify(schema)}\nPrevious response: ${first.text}\nValidation error: ${errorMessage(error)}`;
      let repairedResponse: LLMProviderRequestResult | undefined;
      try {
        repairedResponse = await request(repairPrompt, schema, {
          ...requestOptions,
          schemaName: `${requestOptions.schemaName || "response"}_repair`,
        });
        return validateAndReturn(repairedResponse.text, schema) as LLMGenerationResult<Schema>;
      } catch (repairError) {
        if (repairError instanceof LLMResponseError) throw repairError;
        throw new LLMResponseError(
          `LLM response did not match the requested schema after one repair attempt: ${errorMessage(repairError)}`,
          repairedResponse?.payload || first.payload,
          repairError,
        );
      }
    }
  }

  async function generateMulti<const Schema extends JSONSchemaInput | undefined = undefined>(
    requests: readonly (string | LLMMultiGenerationInput<Schema, Env>)[],
    schema?: Schema,
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMGenerationResult<Schema>[]> {
    if (!Array.isArray(requests)) throw new TypeError("generateMulti requires an array of requests");
    return Promise.all(requests.map((item): Promise<LLMGenerationResult<Schema>> => typeof item === "string"
      ? generate<Schema>(item, schema, requestOptions)
      : generate<Schema>(item.prompt, item.schema || schema, { ...requestOptions, ...(item.options || {}) })));
  }

  async function generateJob<const Schema extends JSONSchemaInput | undefined = undefined>(
    jobId: string,
    prompt: string,
    schema?: Schema,
    requestOptions: LLMJobGenerationOptions<LLMGenerationResult<Schema>, Env> = {},
  ) {
    const { job: jobOptions = {}, ...generationOptions } = requestOptions;
    const env = generationOptions.env || options.env;
    if (!env?.DB) throw new TypeError("generateJob requires an environment with DB");
    const onText = generationOptions.onText;
    const onUsage = generationOptions.onUsage;
    return executeJob<LLMGenerationResult<Schema>, unknown>(env, jobId, async ({ report }) => {
      await report({ phase: "generating" });
      const value = await generate(prompt, schema, {
        ...generationOptions,
        onText: async (text) => {
          if (onText) await onText(text);
          await report({ phase: "generated" });
        },
        onUsage: async (usage) => {
          if (onUsage) await onUsage(usage);
          await report({ phase: "generating", usage });
        },
      });
      return value;
    }, {
      who: jobOptions.who || generationOptions.who || "system:update",
      ctx: jobOptions.ctx || generationOptions.ctx,
      toJobResult: jobOptions.toJobResult || emptyJobResult,
    });
  }

  async function review<const Schema extends JSONSchemaInput | undefined = undefined>(
    originalText: string,
    reviewPrompt: string,
    schema?: Schema,
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMGenerationResult<Schema>> {
    if (typeof originalText !== "string" || typeof reviewPrompt !== "string") {
      throw new TypeError("review text and prompt must be strings");
    }
    return generate(`${reviewPrompt}\n\nOriginal output to review:\n${originalText}`, schema, requestOptions);
  }

  async function reviewMulti<const Schema extends JSONSchemaInput | undefined = undefined>(
    originalText: string,
    reviewPrompts: readonly (string | LLMReviewInput<Env>)[],
    schema?: Schema,
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMGenerationResult<Schema>[]> {
    if (!Array.isArray(reviewPrompts)) throw new TypeError("reviewMulti requires an array of review prompts");
    return Promise.all(reviewPrompts.map((item) => {
      const prompt = typeof item === "string" ? item : item.prompt;
      const name = typeof item === "string" ? undefined : item.name;
      return review(originalText, prompt, schema, {
        ...requestOptions,
        ...(typeof item === "object" ? item.options : {}),
        metadata: { ...requestOptions.metadata, ...(name ? { reviewer: name } : {}) },
      });
    }));
  }

  return { listModels, generate, generateJob, generateMulti, review, reviewMulti };
}

function validateProviderResponse(payload: unknown): ProviderResponsePayload {
  if (!isRecord(payload)) throw new LLMResponseError("LLM returned a malformed response", payload);
  if (payload.output_text !== undefined && typeof payload.output_text !== "string") {
    throw new LLMResponseError("LLM returned a malformed response", payload);
  }
  if (payload.usage !== undefined && !isProviderUsage(payload.usage)) {
    throw new LLMResponseError("LLM returned a malformed response", payload);
  }
  if (payload.output !== undefined && !isProviderOutput(payload.output)) {
    throw new LLMResponseError("LLM returned a malformed response", payload);
  }
  return payload;
}

function isProviderUsage(value: unknown): value is ProviderUsage {
  if (!isRecord(value)) return false;
  return ["input_tokens", "prompt_tokens", "output_tokens", "completion_tokens", "total_tokens"]
    .every((key) => value[key] === undefined || isFiniteNonNegativeNumber(value[key]));
}

function isProviderOutput(value: unknown): value is ProviderOutputItem[] {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && (item.content === undefined || (Array.isArray(item.content) && item.content.every((content) => isRecord(content)
      && (content.type === undefined || typeof content.type === "string")
      && (content.text === undefined || typeof content.text === "string")))));
}

function extractText(payload: ProviderResponsePayload): string {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return "";
}

function normalizeUsage(usage?: ProviderUsage): LLMTokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? usage?.prompt_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function normalizeUsageFromPayload(payload: unknown): LLMTokenUsage {
  if (!isRecord(payload) || payload.usage === undefined) return normalizeUsage();
  if (!isProviderUsage(payload.usage)) throw new LLMResponseError("LLM returned a malformed response", payload);
  return normalizeUsage(payload.usage);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyJobResult(): Record<string, never> { return {}; }
