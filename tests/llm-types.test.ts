import { createLLM } from "../src/features/llm/index.js";
import type {
  InferJSONSchema,
  JSONSchemaInput,
  LLMClientOptions,
  LLMEnvironment,
  LLMGenerationResult,
  LLMRequestOptions,
  LLMTokenUsage,
} from "../src/features/llm/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

const answerSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "confidence"],
} as const satisfies JSONSchemaInput;

type Answer = InferJSONSchema<typeof answerSchema>;
type _answerInference = Assert<Equal<Answer, {
  answer: string;
  confidence: number;
  tags?: string[];
}>>;
type _generationInference = Assert<Equal<LLMGenerationResult<typeof answerSchema>, Answer>>;

interface AppEnvironment extends LLMEnvironment {
  LLM_API_TOKEN: string;
  TENANT: string;
}

const options: LLMClientOptions<AppEnvironment> = {
  apiToken: (env) => env?.LLM_API_TOKEN,
  headers: (env) => ({ "x-tenant": env?.TENANT || "unknown" }),
};
const requestOptions: LLMRequestOptions<AppEnvironment> = {
  onUsage: (usage: LLMTokenUsage) => { void usage.totalTokens; },
};
const client = createLLM(options);

async function assertClientInference(): Promise<void> {
  const generated = await client.generate("answer", answerSchema, requestOptions);
  const answer: string = generated.answer;
  const confidence: number = generated.confidence;
  const multiple = await client.generateMulti(["one", { prompt: "two" }], answerSchema);
  const reviewed = await client.review("original", "review it", answerSchema);
  void [answer, confidence, multiple[0]?.answer, reviewed.tags];
}

void assertClientInference;
