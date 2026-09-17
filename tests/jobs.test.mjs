import assert from "node:assert/strict";
import test from "node:test";
import { eventRooms } from "../src/core/events/index.js";
import { completeJob, createJob, dispatchJob, executeJob, failJob, getJob, listJobEvents, listJobs, runJob, startJob, updateJobProgress } from "../src/core/jobs/index.js";
import { createWorker } from "../src/index.js";

function database() {
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
          const id = statement.args.at(-1);
          const row = jobs.get(id);
          for (const [index, assignment] of [...sql.matchAll(/([a-z_]+) = \?/g)].entries()) row[assignment[1]] = statement.args[index];
        }
        return {};
      };
      statement.first = async () => {
        if (sql.includes("SELECT * FROM core_jobs WHERE id")) return jobs.get(statement.args[0]) || null;
        return null;
      };
      statement.all = async () => {
        if (sql.includes("FROM core_jobs")) return { results: [...jobs.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, statement.args.at(-1)) };
        if (sql.includes("FROM core_job_events")) return { results: events.filter((event) => event.job_id === statement.args[0]).slice(0, statement.args[1]) };
        return { results: [] };
      };
      return statement;
    },
  };
}

test("generic jobs persist lifecycle state and job events", async () => {
  const db = database();
  const received = [];
  const env = { DB: db, eventHandler: async (event) => received.push(event) };
  const created = await createJob(env, { type: "recipe.development", ownerId: "user-1", resourceType: "recipe_candidate", resourceId: "candidate-1", input: { prompt: "cook" } }, { who: "user:user-1" });
  assert.equal(created.status, "queued");
  assert.deepEqual(created.input, { prompt: "cook" });
  await startJob(env, created.id, { who: "user:user-1" });
  await updateJobProgress(env, created.id, { phase: "reviewing", percent: 75 }, { who: "user:user-1" });
  const completed = await completeJob(env, created.id, { slug: "new-recipe" }, { who: "user:user-1" });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.result.slug, "new-recipe");
  assert.equal((await getJob(env, created.id)).finishedAt !== null, true);
  assert.equal((await listJobs(env, { ownerId: "user-1" })).length, 1);
  assert.equal((await listJobEvents(env, created.id)).map((event) => event.type).join(","), "job.created,job.running,job.progress,job.succeeded");
  assert.equal(received.at(-1).what, "job.succeeded");
});

test("failed jobs retain safe error details and target the owning user room", async () => {
  const db = database();
  const env = { DB: db, eventHandler: async () => {} };
  const job = await createJob(env, { type: "messaging.reply", ownerId: "user-2", tenantId: "tenant-1" });
  const failed = await failJob(env, job.id, Object.assign(new Error("provider unavailable"), { code: "upstream_unavailable" }));
  assert.deepEqual(failed.error, { name: "Error", message: "provider unavailable", code: "upstream_unavailable" });
  assert.deepEqual(eventRooms({ who: "system", details: { audience: { userId: "user-2", tenantId: "tenant-1" } } }), ["user:user-2", "tenant:tenant-1"]);
});

test("job executors report progress and can persist a compact result", async () => {
  const db = database();
  const env = { DB: db, eventHandler: async () => {} };
  const execution = await runJob(env, { type: "recipe.development", ownerId: "user-4" }, async ({ report }) => {
    await report({ phase: "generating", percent: 25 });
    return { recipe: { slug: "weeknight-soup", body: "large generated value" } };
  }, { toJobResult: (value) => ({ slug: value.recipe.slug }) });
  assert.equal(execution.job.status, "succeeded");
  assert.deepEqual(execution.job.result, { slug: "weeknight-soup" });
  assert.equal(execution.value.recipe.body, "large generated value");
});

test("workflow dispatch uses the durable job id and records dispatch failures", async () => {
  const db = database();
  const env = { DB: db, eventHandler: async () => {} };
  const calls = [];
  const job = await dispatchJob(env, { type: "messaging.reply", ownerId: "user-5" }, {
    workflow: { create: async (options) => calls.push(options) },
    params: { conversationId: "conversation-1" },
  });
  assert.deepEqual(calls, [{ id: job.id, params: { conversationId: "conversation-1", jobId: job.id } }]);
  const executed = await executeJob(env, job.id, async () => ({ messageId: "message-1" }));
  assert.equal(executed.job.status, "succeeded");

  await assert.rejects(() => dispatchJob(env, { type: "messaging.reply", ownerId: "user-5" }, {
    workflow: { create: async () => { throw new Error("dispatch unavailable"); } },
  }), /dispatch unavailable/);
  assert.equal([...db.jobs.values()].filter((row) => row.status === "failed").length, 1);
});

test("worker exposes owner-scoped durable jobs", async () => {
  const db = database();
  const env = { DB: db };
  await createJob(env, { type: "recipe.development", ownerId: "user-3" });
  const worker = createWorker({ app: { name: "worker", features: [{ name: "auth", getUser: async () => ({ sub: "subject-3", authUser: { id: "user-3", is_admin: false } }) }] }, fetch: async () => new Response("site") });
  const response = await worker.fetch(new Request("https://example.test/api/jobs"), env, { waitUntil() {} });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).jobs.length, 1);
});
