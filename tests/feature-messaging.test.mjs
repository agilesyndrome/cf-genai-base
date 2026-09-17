import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createJob, getJob } from "../src/index.js";
import { DataScopeError } from "../src/data/index.js";
import {
  conversation,
  createMessagingFeature,
  createMessagingStore,
  MessagingDomain,
  executeReplyJob,
  groupMessage,
  message,
  participant,
  PACKAGE_NAME,
  VERSION,
} from "../src/features/messaging/index.js";

test("base ships the messaging schema migration", async () => {
  const migration = await fs.readFile(new URL("../migrations/0007_messaging.sql", import.meta.url), "utf8");
  const integrity = await fs.readFile(new URL("../migrations/0008_messaging_tenant_integrity.sql", import.meta.url), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS messaging_conversations/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS messaging_messages/);
  assert.match(migration, /tenant_id TEXT NOT NULL REFERENCES auth_tenants/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, conversation_id, context\)/);
  assert.match(integrity, /conversation tenant or context mismatch/);
});

test("messaging stores require a scoped reader", () => {
  assert.throws(() => createMessagingStore({ prepare() {} }), /scoped data reader/);
});

class FakeReader {
  constructor(actorContext = null) {
    this.actorContext = actorContext;
    this.conversations = [];
    this.participants = [];
    this.messages = [];
    this.nextConversation = 1;
    this.nextParticipant = 1;
    this.nextMessage = 1;
  }

  async context() { return this.actorContext; }

  rows(name) {
    return {
      messaging_conversations: this.conversations,
      messaging_conversation_participants: this.participants,
      messaging_messages: this.messages,
    }[name];
  }

  async list(name, { where = {}, limit = 100, orderBy = "id ASC" } = {}) {
    const rows = this.rows(name).filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    if (orderBy.endsWith("DESC")) rows.reverse();
    return rows.slice(0, limit);
  }

  async get(name, id) {
    return this.rows(name).find((row) => row.id === id) || null;
  }

  async insert(name, values) {
    const next = name === "messaging_conversations" ? this.nextConversation++ : name === "messaging_conversation_participants" ? this.nextParticipant++ : this.nextMessage++;
    const row = { id: next, ...values, created_at: "now", updated_at: "now" };
    this.rows(name).push(row);
    return row;
  }

  async update(name, id, values) {
    const row = await this.get(name, id);
    Object.assign(row, values);
    return row;
  }

  async delete(name, id) {
    const rows = this.rows(name);
    const index = rows.findIndex((row) => row.id === id);
    if (index >= 0) rows.splice(index, 1);
    return { success: true };
  }

  async deleteWhere(name, where) {
    const rows = this.rows(name);
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (Object.entries(where).every(([key, value]) => rows[index][key] === value)) rows.splice(index, 1);
    }
    return { success: true };
  }
}

class JobD1 {
  constructor() { this.jobs = new Map(); this.events = []; }
  prepare(sql) {
    const db = this;
    const statement = { args: [], bind(...args) { this.args = args; return this; } };
    statement.run = async () => {
      if (sql.includes("INSERT INTO core_jobs")) {
        const [id, type, status, ownerId, tenantId, resourceType, resourceId, input, progress, createdAt, updatedAt, expiresAt] = statement.args;
        db.jobs.set(id, { id, type, status, owner_id: ownerId, tenant_id: tenantId, resource_type: resourceType, resource_id: resourceId, input_json: input, result_json: "{}", error_json: null, progress_json: progress, created_at: createdAt, started_at: null, finished_at: null, updated_at: updatedAt, expires_at: expiresAt });
      } else if (sql.includes("INSERT INTO core_job_events")) {
        const [id, jobId, type, payload] = statement.args;
        db.events.push({ id, job_id: jobId, type, payload_json: payload, created_at: new Date().toISOString() });
      } else if (sql.startsWith("UPDATE core_jobs SET")) {
        const row = db.jobs.get(statement.args.at(-1));
        for (const [index, assignment] of [...sql.matchAll(/([a-z_]+) = \?/g)].entries()) row[assignment[1]] = statement.args[index];
      }
      return {};
    };
    statement.first = async () => sql.includes("SELECT * FROM core_jobs WHERE id") ? db.jobs.get(statement.args[0]) || null : null;
    statement.all = async () => ({ results: [] });
    return statement;
  }
}

test("domain models support opaque contexts and group audiences", () => {
  const thread = conversation({
    context: "recipe://123",
    participants: [{ type: "reviewer", key: "gordon", name: "Gordon Ramsay" }],
  });
  const note = message({
    context: "recipe://123/ingredient/salt",
    sender: { type: "user", key: "alex", name: "Alex" },
    body: "Add more salt",
  });
  const group = groupMessage({
    context: "recipe://123",
    sender: { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
    audience: [{ type: "user", key: "alex", name: "Alex" }],
    body: "It already had enough.",
  });

  assert.equal(thread.context, "recipe://123");
  assert.equal(note.context, "recipe://123/ingredient/salt");
  assert.equal(group.isGroup, true);
  assert.equal(group.audience[0].name, "Alex");
  assert.throws(() => conversation({ context: "" }), /context is required/);
  assert.throws(() => participant({ participantType: "user", participantKey: "alex", displayName: "Alex" }), /unsupported fields/);
  assert.throws(() => message({ senderType: "user", senderKey: "alex", senderName: "Alex", body: "hello" }), /unsupported fields/);
});

test("D1 store persists a context-scoped group conversation and messages", async () => {
  const store = createMessagingStore(new FakeReader());
  const thread = await store.getOrCreateConversation({
    context: "recipe://123",
    createdBy: { type: "user", key: "alex", name: "Alex" },
    participants: [
      { type: "user", key: "alex", name: "Alex" },
      { type: "chef", key: "chef", name: "Chef" },
      { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
    ],
  });
  const saved = await store.appendMessage(thread.id, groupMessage({
    sender: { type: "reviewer", key: "gordon", name: "Gordon Ramsay" },
    body: "Bloody hell, it already had enough salt.",
    audience: [{ type: "user", key: "alex", name: "Alex" }],
    metadata: { source: "re-review" },
  }));
  const loaded = await store.findConversation("recipe://123");

  assert.equal(thread.context, "recipe://123");
  assert.equal(saved.context, "recipe://123");
  assert.equal(saved.sender.name, "Gordon Ramsay");
  assert.equal(saved.metadata.source, "re-review");
  assert.equal(loaded.participants.length, 3);
  assert.equal(loaded.messages.length, 1);
  assert.equal(loaded.messages[0].isGroup, true);
});

test("messaging enforces participant access and derives sender identity", async () => {
  const reader = new FakeReader({ userId: "user-1", tenantId: "tenant-1", scopes: [] });
  const store = createMessagingStore(reader);
  const thread = await store.createConversation({
    context: "private://thread",
    createdBy: { type: "user", key: "spoofed", name: "Spoofed" },
  });
  const saved = await store.appendMessage(thread.id, {
    sender: { type: "user", key: "spoofed", name: "Spoofed" },
    context: "wrong://context",
    body: "Hello",
  });
  assert.equal(thread.createdBy.key, "user-1");
  assert.equal(saved.sender.key, "user-1");
  assert.equal(saved.context, "private://thread");

  reader.actorContext = { userId: "user-2", tenantId: "tenant-1", scopes: [] };
  await assert.rejects(() => store.findConversationById(thread.id), DataScopeError);
  assert.deepEqual(await store.listConversations(), []);
});

test("durable reply jobs keep generation provider-neutral and persist the reply", async () => {
  const messages = createMessagingStore(new FakeReader());
  const thread = await messages.createConversation({
    context: "recipe://job-test",
    createdBy: { type: "user", key: "alex", name: "Alex" },
    participants: [{ type: "assistant", key: "chef", name: "Chef" }],
  });
  await messages.appendMessage(thread.id, { sender: { type: "user", key: "alex", name: "Alex" }, body: "What should I cook?" });
  const DB = new JobD1();
  const env = { DB, eventHandler: async () => {} };
  const job = await createJob(env, { type: "messaging.reply", ownerId: "alex", resourceType: "conversation", resourceId: thread.id });
  const execution = await executeReplyJob(env, job.id, {
    store: messages,
    conversationId: thread.id,
    sender: { type: "assistant", key: "chef", name: "Chef" },
    generate: ({ messages: history }) => ({ body: `I saw ${history.length} message.`, metadata: { model: "test" } }),
  });
  assert.equal(execution.value.body, "I saw 1 message.");
  assert.deepEqual(execution.job.result, { conversationId: String(thread.id), messageId: String(execution.value.id) });
  assert.equal((await getJob(env, job.id)).status, "succeeded");
  assert.equal((await messages.findConversationById(thread.id)).messages.length, 2);
});

test("feature middleware remains composable", async () => {
  const feature = createMessagingFeature({ name: "messaging" });
  assert.equal(feature.domains[0].dataResources.length, 3);
  const response = await feature.middleware(new Request("https://example.test/"), {}, {}, () => Response.json({ ok: true }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("feature exposes package identity and host-supplied capabilities", () => {
  const domains = [new MessagingDomain({ dataResources: [{ name: "messages" }] })];
  const feature = createMessagingFeature({ name: "messaging", domains });
  assert.equal(feature.packageName, PACKAGE_NAME);
  assert.equal(feature.version, VERSION);
  assert.deepEqual(feature.domains[0].dataResources, [{ name: "messages" }]);
  assert.equal(feature.domains, domains);
});
