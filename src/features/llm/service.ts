import { requireFeatureCircuit } from "../../core/circuits/index.js";
import type {
  JSONSchemaInput,
  LLMClient,
  LLMEnvironment,
  LLMGenerationResult,
  LLMRequestOptions,
  LLMReviewInput,
} from "./model.js";

export interface LLMServiceOptions<Env extends LLMEnvironment = LLMEnvironment> {
  client: LLMClient<Env>;
  featureName?: string;
  breakerId?: string;
  metadata?: Record<string, unknown>;
  onFailure?: (context: { env: Env; operation: string; requestId: string; error: unknown }) => void | Promise<void>;
  onSuccess?: (context: { env: Env; operation: string; requestId: string }) => void | Promise<void>;
}

/**
 * Application-facing LLM facade. Provider mechanics remain in createLLM;
 * this layer standardizes circuit checks, request IDs, metadata, and hooks
 * for application-specific telemetry or persistence.
 */
export function createLLMService<Env extends LLMEnvironment = LLMEnvironment>(
  options: LLMServiceOptions<Env>,
) {
  const featureName = options.featureName || "llm";
  const breakerId = options.breakerId || `${featureName}:llm-models`;
  const metadata = options.metadata || {};

  async function run<Result>(
    env: Env,
    operation: string,
    requestOptions: LLMRequestOptions<Env> | undefined,
    work: (requestId: string, mergedOptions: LLMRequestOptions<Env>) => Promise<Result>,
  ): Promise<Result> {
    const requestId = requestOptions?.requestId || crypto.randomUUID();
    const mergedOptions: LLMRequestOptions<Env> = {
      ...requestOptions,
      env,
      requestId,
      metadata: { ...metadata, ...(requestOptions?.metadata || {}), type: requestOptions?.metadata?.type || operation },
    };
    try {
      await requireFeatureCircuit(env, {
        feature: featureName,
        breakerId,
        operation,
        requestId,
        who: mergedOptions.who || "system:read",
      });
      const result = await work(requestId, mergedOptions);
      await options.onSuccess?.({ env, operation, requestId });
      return result;
    } catch (error) {
      await options.onFailure?.({ env, operation, requestId, error });
      throw error;
    }
  }

  function generate<const Schema extends JSONSchemaInput | undefined = undefined>(
    env: Env,
    input: string,
    schema?: Schema,
    name = "response",
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMGenerationResult<Schema>> {
    return run(env, name, requestOptions, (requestId, mergedOptions) => options.client.generate(input, schema, {
      ...mergedOptions,
      requestId,
      schemaName: name,
    }));
  }

  function generateStream<const Schema extends JSONSchemaInput | undefined = undefined>(
    env: Env,
    input: string,
    schema: Schema | undefined,
    name: string,
    onText: NonNullable<LLMRequestOptions<Env>["onText"]> = async () => {},
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMGenerationResult<Schema>> {
    return generate(env, input, schema, name, { ...requestOptions, onText });
  }

  function reviewMulti<const Schema extends JSONSchemaInput | undefined = undefined>(
    env: Env,
    originalText: string,
    prompts: readonly (string | LLMReviewInput<Env>)[],
    schema?: Schema,
    name = "review",
    requestOptions: LLMRequestOptions<Env> = {},
  ): Promise<LLMGenerationResult<Schema>[]> {
    return run(env, name, requestOptions, (requestId, mergedOptions) => options.client.reviewMulti(originalText, prompts, schema, {
      ...mergedOptions,
      requestId,
      schemaName: name,
    }));
  }

  return { generate, generateStream, reviewMulti };
}
