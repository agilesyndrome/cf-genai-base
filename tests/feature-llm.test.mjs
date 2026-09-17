import test from "node:test";
import assert from "node:assert/strict";
import { createJob, getJob } from "../src/index.js";
import { createLLMFeature, createLLM, LLMResponseError, VERSION } from "../src/features/llm/index.js";

test("feature delegates to the next handler", async () => {
  const feature = createLLMFeature({ name: "example" });
  assert.equal(feature.version, VERSION);
  const response = await feature.middleware(new Request("https://example.test/"), {}, {}, () => Response.json({ ok: true }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

const schema = { type: "object", additionalProperties: false, properties: { answer: { type: "string" } }, required: ["answer"] };
function response(text, usage = { input_tokens: 3, output_tokens: 2, total_tokens: 5 }) { return new Response(JSON.stringify({ output_text: text, usage }), { status: 200, headers: { "content-type": "application/json" } }); }

function jobDatabase() {
  const jobs = new Map();
  const events = [];
  return {
    jobs,
    events,
    prepare(sql) {
      const statement = { args: [], bind(...args) { this.args = args; return this; } };
      statement.run = async () => {
        if (sql.includes("INSERT INTO core_jobs")) {
          const [id, type, status, ownerId, tenantId, resourceType, resourceId, input, progress, createdAt, updatedAt, expiresAt] = statement.args;
          jobs.set(id, { id, type, status, owner_id: ownerId, tenant_id: tenantId, resource_type: resourceType, resource_id: resourceId, input_json: input, result_json: "{}", error_json: null, progress_json: progress, created_at: createdAt, started_at: null, finished_at: null, updated_at: updatedAt, expires_at: expiresAt });
        } else if (sql.includes("INSERT INTO core_job_events")) {
          const [id, jobId, type, payload] = statement.args;
          events.push({ id, job_id: jobId, type, payload_json: payload, created_at: new Date().toISOString() });
        } else if (sql.startsWith("UPDATE core_jobs SET")) {
          const row = jobs.get(statement.args.at(-1));
          for (const [index, assignment] of [...sql.matchAll(/([a-z_]+) = \?/g)].entries()) row[assignment[1]] = statement.args[index];
        }
        return {};
      };
      statement.first = async () => sql.includes("SELECT * FROM core_jobs WHERE id") ? jobs.get(statement.args[0]) || null : null;
      statement.all = async () => ({ results: [] });
      return statement;
    },
  };
}

test("generate sends metadata, validates typed output, and logs token counts", async () => {
  const calls = []; const logs = [];
  const llm = createLLM({ env: { LLM_API_TOKEN: "test" }, fetch: async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return response("{\"answer\":\"ok\"}"); }, logger: { debug: (line) => logs.push(JSON.parse(line)), info: (line) => logs.push(JSON.parse(line)) }, metadata: { app: "test" } });
  assert.deepEqual(await llm.generate("hello", schema, { schemaName: "answer", metadata: { type: "unit" } }), { answer: "ok" });
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].headers.Authorization, "Bearer test");
  assert.equal(calls[0].body.metadata.type, "unit");
  const responseLog = logs.find((entry) => entry.event === "llm.response");
  assert.equal(responseLog.usage.totalTokens, 5);
  assert.equal(responseLog.provider, "openai-compatible");
  assert.equal(responseLog.gateway, false);
});

test("apiToken configures the consolidated client", async () => {
  const calls = [];
  const llm = createLLM({
    env: { LLM_API_TOKEN: "environment-token" },
    apiToken: (env) => env.LLM_API_TOKEN,
    fetch: async (_url, init) => { calls.push(init.headers.Authorization); return response("ok"); },
  });
  assert.equal(await llm.generate("hello"), "ok");
  assert.deepEqual(calls, ["Bearer environment-token"]);
});

test("removed LLM aliases fail explicitly", async () => {
  assert.throws(() => createLLM({ apiKey: "old-key" }), /apiKey was removed/);
  assert.throws(() => createLLM({ feature: "old-name" }), /feature was removed/);
  const llm = createLLM({ env: { LLM_API_TOKEN: "test" }, fetch: async () => response("ok") });
  await assert.rejects(() => llm.generate({ prompt: "old object form" }), /prompt must be a string/);
  assert.equal(llm.generateWithSchema, undefined);
});

test("generateJob updates a dispatched base job without persisting generated content", async () => {
  const DB = jobDatabase();
  const env = { DB, LLM_API_TOKEN: "test", eventHandler: async () => {} };
  const job = await createJob(env, { type: "llm.recipe", ownerId: "user-1" });
  const llm = createLLM({ env, fetch: async () => response("{\"answer\":\"secret output\"}") });
  const execution = await llm.generateJob(job.id, "hello", schema, {
    job: { toJobResult: (value) => ({ answerLength: value.answer.length }) },
  });
  assert.deepEqual(execution.value, { answer: "secret output" });
  assert.deepEqual(execution.job.result, { answerLength: 13 });
  assert.equal((await getJob(env, job.id)).status, "succeeded");
  assert.deepEqual(DB.events.map((event) => event.type), ["job.created", "job.running", "job.progress", "job.progress", "job.progress", "job.succeeded"]);
});

test("Cloudflare AI Gateway routes Responses and model health through the gateway", async () => {
  const calls = [];
  const llm = createLLM({
    env: { LLM_API_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/", LLM_API_TOKEN: "gateway-key" },
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return init.method === "GET"
        ? new Response(JSON.stringify({ data: [{ id: "gpt-5.4" }] }), { status: 200 })
        : response("gateway response");
    },
  });

  assert.equal(await llm.generate("hello"), "gateway response");
  assert.deepEqual(await llm.listModels(), [{ id: "gpt-5.4" }]);
  assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses");
  assert.equal(calls[1].url, "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/models");
  assert.equal(calls[0].headers["cf-aig-authorization"], "Bearer gateway-key");
});

test("environment configuration supports Gateway routing and provider-neutral names", async () => {
  const calls = [];
  const llm = createLLM({
    env: { LLM_API_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses", LLM_API_TOKEN: "gateway-key", LLM_MODEL: "gpt-5.4-mini" },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return response("ok"); },
  });

  assert.equal(await llm.generate("hello"), "ok");
  assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses");
  assert.equal(calls[0].body.model, "gpt-5.4-mini");
});

test("the universal URL selects direct routing or Cloudflare Gateway routing", async () => {
  const calls = [];
  const llm = createLLM({
    env: { LLM_API_URL: "https://api.openai.com/v1/responses", LLM_API_TOKEN: "openai-key" },
    fetch: async (url) => { calls.push(url); return response("ok"); },
  });

  assert.equal(await llm.generate("hello"), "ok");
  assert.equal(calls[0], "https://api.openai.com/v1/responses");
});

test("universal URL, token, and model variables support OpenAI-compatible endpoints", async () => {
  const calls = [];
  const llm = createLLM({
    env: { LLM_API_URL: "https://openrelay.example/v1/responses", LLM_API_TOKEN: "relay-key", LLM_MODEL: "relay-model" },
    fetch: async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return response("ok"); },
  });

  assert.equal(await llm.generate("hello"), "ok");
  assert.equal(calls[0].url, "https://openrelay.example/v1/responses");
  assert.equal(calls[0].headers.Authorization, "Bearer relay-key");
  assert.equal(calls[0].body.model, "relay-model");
});

test("auto model selection uses the compatible endpoint's model list", async () => {
  const calls = [];
  const llm = createLLM({
    env: { LLM_API_URL: "https://openrelay.example/v1/responses", LLM_API_TOKEN: "relay-key", LLM_MODEL: "auto" },
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
      return init.method === "GET" ? new Response(JSON.stringify({ data: [{ id: "auto-model" }] }), { status: 200 }) : response("ok");
    },
  });

  assert.equal(await llm.generate("hello"), "ok");
  assert.equal(calls[0].url, "https://openrelay.example/v1/models");
  assert.equal(calls[1].body.model, "auto-model");
});

test("generateMulti starts parallel typed requests and reviewMulti preserves order", async () => {
  let active = 0; let peak = 0;
  const llm = createLLM({ env: { LLM_API_TOKEN: "test" }, fetch: async (_url, init) => { active++; peak = Math.max(peak, active); const body = JSON.parse(init.body); await new Promise((resolve) => setTimeout(resolve, 5)); active--; return response(JSON.stringify({ answer: body.input.includes("two") ? "two" : "one" })); } });
  const results = await llm.generateMulti(["one", "two"], schema);
  assert.deepEqual(results, [{ answer: "one" }, { answer: "two" }]); assert.equal(peak, 2);
  assert.deepEqual(await llm.reviewMulti("source", ["first", "second"], schema), [{ answer: "one" }, { answer: "one" }]);
});

test("invalid typed output gets one repair, then exposes the raw model response", async () => {
  let count = 0;
  const llm = createLLM({ env: { LLM_API_TOKEN: "test" }, fetch: async () => { count++; return response(count === 1 ? "{\"wrong\":true}" : "{\"answer\":\"fixed\"}"); } });
  assert.deepEqual(await llm.generate("repair me", schema), { answer: "fixed" }); assert.equal(count, 2);
  const failing = createLLM({ env: { LLM_API_TOKEN: "test" }, fetch: async () => response("{\"wrong\":true}") });
  await assert.rejects(() => failing.generate("fail", schema), (error) => error instanceof LLMResponseError && error.responseFailed && error.llmResponse.output_text === "{\"wrong\":true}");
});

test("malformed provider responses fail at the response boundary", async () => {
  const malformedGeneration = createLLM({
    env: { LLM_API_TOKEN: "test" },
    fetch: async () => new Response(JSON.stringify({ output_text: 42 }), { status: 200 }),
  });
  await assert.rejects(
    () => malformedGeneration.generate("hello"),
    (error) => error instanceof LLMResponseError
      && error.message === "LLM returned a malformed response"
      && error.llmResponse.output_text === 42,
  );

  const malformedUsage = createLLM({
    env: { LLM_API_TOKEN: "test" },
    fetch: async () => new Response(JSON.stringify({ output_text: "ok", usage: { total_tokens: "five" } }), { status: 200 }),
  });
  await assert.rejects(() => malformedUsage.generate("hello"), /malformed response/);

  const malformedModels = createLLM({
    env: { LLM_API_TOKEN: "test", LLM_MODEL: "auto" },
    fetch: async () => new Response(JSON.stringify({ data: [{ name: "missing-id" }] }), { status: 200 }),
  });
  await assert.rejects(
    () => malformedModels.generate("hello"),
    (error) => error instanceof LLMResponseError && error.message === "Automatic model selection failed",
  );
});

test("invalid LLM configuration fails before provider access without exposing secrets", async () => {
  let calls = 0;
  const fetch = async () => { calls++; return response("unused"); };
  const invalidUrl = createLLM({ env: { LLM_API_URL: "not a url", LLM_API_TOKEN: "super-secret" }, fetch });
  await assert.rejects(() => invalidUrl.generate("hello"), (error) => {
    assert.equal(error.message, "LLM_API_URL must be a valid URL");
    assert.equal(error.message.includes("super-secret"), false);
    return true;
  });
  const insecureUrl = createLLM({ env: { LLM_API_URL: "http://provider.example/v1", LLM_API_TOKEN: "super-secret" }, fetch });
  await assert.rejects(() => insecureUrl.generate("hello"), /must use HTTPS/);
  const missingToken = createLLM({ fetch });
  await assert.rejects(() => missingToken.generate("hello"), /LLM_API_TOKEN is not configured/);
  assert.equal(calls, 0);
});
