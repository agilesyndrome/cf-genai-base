import type { Job } from "../../core/jobs/index.js";

export interface LLMEnvironment {
  DB?: D1Database;
  LLM_API_URL?: string;
  LLM_API_TOKEN?: string;
  LLM_MODEL?: string;
  [key: string]: unknown;
}

export type LLMProvider = "cloudflare-ai-gateway" | "openai-compatible";
export type LLMConfigValue<Value, Env extends LLMEnvironment = LLMEnvironment> =
  | Value
  | ((env: Env | undefined) => Value | undefined);

export type LLMHeaders = Record<string, string>;
export type LLMMetadata = Record<string, unknown>;

export interface LLMLogger {
  debug?: (message: string) => void;
  info?: (message: string) => void;
  error?: (message: string) => void;
}

export interface LLMTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type LLMUsageCallback = (usage: LLMTokenUsage) => void | Promise<void>;
export type LLMTextCallback = (text: string) => void | Promise<void>;

export interface LLMClientOptions<Env extends LLMEnvironment = LLMEnvironment> {
  env?: Env;
  fetch?: typeof fetch;
  logger?: LLMLogger;
  metadata?: LLMMetadata;
  debugLogging?: boolean;
  featureName?: string;
  breakerId?: string;
  healthcheckId?: string;
  allowDynamicApiUrl?: boolean;
  apiUrl?: LLMConfigValue<string, Env>;
  apiToken?: LLMConfigValue<string, Env>;
  model?: LLMConfigValue<string, Env>;
  headers?: LLMConfigValue<LLMHeaders, Env>;
}

export interface LLMRequestOptions<Env extends LLMEnvironment = LLMEnvironment> {
  env?: Env;
  signal?: AbortSignal;
  who?: string;
  ctx?: ExecutionContext;
  requestId?: string;
  metadata?: LLMMetadata;
  schemaName?: string;
  model?: string;
  apiUrl?: string;
  apiToken?: string;
  headers?: LLMHeaders;
  allowWhenCircuitTripped?: boolean;
  onUsage?: LLMUsageCallback;
  onText?: LLMTextCallback;
}

export interface LLMResolvedProviderConfig {
  provider: LLMProvider;
  gateway: boolean;
  endpoint: string;
  modelsEndpoint: string;
  model: string;
  headers: LLMHeaders;
}

interface JSONSchemaAnnotations {
  title?: string;
  description?: string;
  enum?: readonly unknown[];
}

export interface JSONStringSchema extends JSONSchemaAnnotations {
  type: "string";
  enum?: readonly string[];
}

export interface JSONNumberSchema extends JSONSchemaAnnotations {
  type: "number" | "integer";
  enum?: readonly number[];
  minimum?: number;
  maximum?: number;
}

export interface JSONBooleanSchema extends JSONSchemaAnnotations {
  type: "boolean";
  enum?: readonly boolean[];
}

export interface JSONNullSchema extends JSONSchemaAnnotations {
  type: "null";
  enum?: readonly null[];
}

export interface JSONArraySchema extends JSONSchemaAnnotations {
  type: "array";
  items?: JSONSchemaInput;
  minItems?: number;
  maxItems?: number;
}

export interface JSONObjectSchema extends JSONSchemaAnnotations {
  type: "object";
  properties?: Readonly<Record<string, JSONSchemaInput>>;
  required?: readonly string[];
  additionalProperties?: boolean | JSONSchemaInput;
}

export type JSONSchemaInput =
  | JSONStringSchema
  | JSONNumberSchema
  | JSONBooleanSchema
  | JSONNullSchema
  | JSONArraySchema
  | JSONObjectSchema;

type SchemaProperties<Schema> = Schema extends { properties: infer Properties }
  ? Properties extends Readonly<Record<string, JSONSchemaInput>> ? Properties : Record<never, never>
  : Record<never, never>;
type RequiredSchemaKeys<Schema, Properties> = Schema extends { required: readonly (infer Key)[] }
  ? Extract<Key, keyof Properties>
  : never;
type Simplify<Value> = { [Key in keyof Value]: Value[Key] };
type ObjectFromSchema<Schema, Properties = SchemaProperties<Schema>> = Simplify<
  { -readonly [Key in RequiredSchemaKeys<Schema, Properties>]-?: InferJSONSchema<Properties[Key]> }
  & { -readonly [Key in Exclude<keyof Properties, RequiredSchemaKeys<Schema, Properties>>]?: InferJSONSchema<Properties[Key]> }
>;

export type InferJSONSchema<Schema> =
  Schema extends { enum: readonly (infer Value)[] } ? Value
    : Schema extends { type: "string" } ? string
      : Schema extends { type: "integer" | "number" } ? number
        : Schema extends { type: "boolean" } ? boolean
          : Schema extends { type: "null" } ? null
            : Schema extends { type: "array"; items: infer Items extends JSONSchemaInput } ? InferJSONSchema<Items>[]
              : Schema extends { type: "array" } ? unknown[]
                : Schema extends { type: "object" } ? ObjectFromSchema<Schema>
                  : unknown;

export type LLMGenerationResult<Schema extends JSONSchemaInput | undefined = undefined> =
  Schema extends JSONSchemaInput ? InferJSONSchema<Schema> : unknown;

export interface LLMProviderRequestResult {
  text: string;
  payload: Record<string, unknown>;
  usage: LLMTokenUsage;
  requestId: string;
  metadata: LLMMetadata;
}

export interface LLMMultiGenerationInput<
  Schema extends JSONSchemaInput | undefined = JSONSchemaInput | undefined,
  Env extends LLMEnvironment = LLMEnvironment,
> {
  prompt: string;
  schema?: Schema;
  options?: LLMRequestOptions<Env>;
}

export interface LLMReviewInput<Env extends LLMEnvironment = LLMEnvironment> {
  prompt: string;
  name?: string;
  options?: LLMRequestOptions<Env>;
}

export interface LLMJobOptions<Value = unknown> {
  who?: string;
  ctx?: ExecutionContext;
  toJobResult?: (value: Value) => unknown | Promise<unknown>;
}

export interface LLMJobGenerationOptions<
  Value = unknown,
  Env extends LLMEnvironment = LLMEnvironment,
> extends LLMRequestOptions<Env> {
  job?: LLMJobOptions<Value>;
}

export interface LLMJobGenerationResult<Value = unknown> {
  job: Job | null;
  value: Value;
}

export interface LLMClient<Env extends LLMEnvironment = LLMEnvironment> {
  listModels(requestOptions?: LLMRequestOptions<Env>): Promise<Record<string, unknown>[]>;
  generate<const Schema extends JSONSchemaInput | undefined = undefined>(
    prompt: string,
    schema?: Schema,
    requestOptions?: LLMRequestOptions<Env>,
  ): Promise<LLMGenerationResult<Schema>>;
  generateJob<const Schema extends JSONSchemaInput | undefined = undefined>(
    jobId: string,
    prompt: string,
    schema?: Schema,
    requestOptions?: LLMJobGenerationOptions<LLMGenerationResult<Schema>, Env>,
  ): Promise<LLMJobGenerationResult<LLMGenerationResult<Schema>>>;
  generateMulti<const Schema extends JSONSchemaInput | undefined = undefined>(
    requests: readonly (string | LLMMultiGenerationInput<Schema, Env>)[],
    schema?: Schema,
    requestOptions?: LLMRequestOptions<Env>,
  ): Promise<LLMGenerationResult<Schema>[]>;
  review<const Schema extends JSONSchemaInput | undefined = undefined>(
    originalText: string,
    reviewPrompt: string,
    schema?: Schema,
    requestOptions?: LLMRequestOptions<Env>,
  ): Promise<LLMGenerationResult<Schema>>;
  reviewMulti<const Schema extends JSONSchemaInput | undefined = undefined>(
    originalText: string,
    reviewPrompts: readonly (string | LLMReviewInput<Env>)[],
    schema?: Schema,
    requestOptions?: LLMRequestOptions<Env>,
  ): Promise<LLMGenerationResult<Schema>[]>;
}
