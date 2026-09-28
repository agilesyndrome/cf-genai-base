import assert from "node:assert/strict";
import test from "node:test";
import { defineRecord, text, booleanField, versioned, workflow, openStreetMapLocation, VersionedRecordStore, RecordStore, RecordAccessError } from "../src/data/index.js";
import { createSqliteD1, repositoryMigrations } from "./sqlite-d1.mjs";

const migrations = repositoryMigrations(new URL("../examples/todo-list/test/integration.test.mjs", import.meta.url));

function setup() {
  const DB = createSqliteD1({
    migrations,
    seed(database) {
      database.exec("INSERT OR IGNORE INTO auth_users (id, provider, subject) VALUES ('record-user', 'test', 'record-user');");
      database.exec("INSERT OR IGNORE INTO auth_user_tenants (user_id, tenant_id) VALUES ('record-user', 'easley-family');");
    },
  });
  const record = defineRecord({
    name: "recipes",
    fields: { title: text({ required: true }), done: booleanField() },
    with: [versioned({ publicRead: true, writeScope: "recipes:write", publishScope: "recipes:publish" })],
  });
  return { DB, store: new VersionedRecordStore(record), actor: { userId: "record-user", tenantId: "easley-family", scopes: ["recipes:write", "recipes:publish"] } };
}

test("records preserve drafts, publication, versions, and optimistic concurrency", async () => {
  const { DB, store, actor } = setup();
  const created = await store.create({ DB }, actor, { title: "Soup", done: false });
  assert.equal(await store.read({ DB }, { publicTenantId: "easley-family" }, created.id), null);
  await store.publish({ DB }, actor, created.id, 1);
  const saved = await store.save({ DB }, actor, created.id, 1, { title: "Better soup", done: true });
  assert.equal(saved.revision, 2);
  assert.equal((await store.read({ DB }, { publicTenantId: "easley-family" }, created.id)).content.title, "Soup");
  assert.equal((await store.read({ DB }, actor, created.id, true)).content.title, "Better soup");
  await assert.rejects(store.save({ DB }, actor, created.id, 1, { title: "Stale" }), (error) => error instanceof RecordAccessError && error.status === 409);
  assert.deepEqual((await store.versions({ DB }, actor, created.id)).map((entry) => entry.revision), [2, 1]);
  await store.unpublish({ DB }, actor, created.id);
  assert.equal(await store.read({ DB }, actor, created.id), null);
  DB.close();
});

test("record fields reject unknown and required values", async () => {
  const record = defineRecord({ name: "notes", fields: { title: text({ required: true }) }, with: [versioned()] });
  const store = new VersionedRecordStore(record);
  await assert.rejects(store.create({ DB: {} }, { userId: "u", tenantId: "t" }, { body: "unknown" }), /Unknown record field/);
  await assert.rejects(store.create({ DB: {} }, { userId: "u", tenantId: "t" }, {}), /Required record field/);
});

test("records require the versioned mixin exactly once", () => {
  assert.doesNotThrow(() => defineRecord({ name: "plain", fields: { title: text() }, with: [] }));
  assert.throws(() => defineRecord({ name: "duplicate", fields: { title: text() }, with: [versioned(), versioned()] }), /may use versioned/);
});

test("workflow and OpenStreetMap mix-ins add validated record behavior", async () => {
  const { DB, actor } = setup();
  const record = defineRecord({
    name: "places",
    fields: { title: text({ required: true }) },
    with: [
      versioned({ writeScope: "places:write" }),
      workflow({ states: ["todo", "inprogress", "done"], transitions: { todo: ["inprogress"], inprogress: ["done"] } }),
      openStreetMapLocation(),
    ],
  });
  const store = new VersionedRecordStore(record);
  const placeActor = { ...actor, scopes: [...actor.scopes, "places:write"] };
  const created = await store.create({ DB }, placeActor, { title: "Park", osm_type: "node", osm_id: "123", osm_latitude: 43.65, osm_longitude: -79.38 });
  assert.equal(created.content.workflow_state, "todo");
  const transitioned = await store.transition({ DB }, placeActor, created.id, 1, "inprogress");
  assert.equal(transitioned.content.workflow_state, "inprogress");
  await assert.rejects(store.save({ DB }, placeActor, created.id, 2, { title: "Park", workflow_state: "todo", osm_type: "node", osm_id: "123", osm_latitude: 43.65, osm_longitude: -79.38 }), /cannot transition/);
  await assert.rejects(store.create({ DB }, placeActor, { title: "Invalid", osm_type: "node", osm_id: "123", osm_latitude: 91, osm_longitude: 0 }), /latitude/);
  DB.close();
});

test("workflow-only records use the simple record store", async () => {
  const { DB, actor } = setup();
  const record = defineRecord({ name: "tasks", fields: { title: text() }, with: [workflow({ states: ["todo", "done"] })] });
  const store = new RecordStore(record);
  const created = await store.create({ DB }, actor, { title: "Try records" });
  assert.equal(created.content.workflow_state, "todo");
  const completed = await store.transition({ DB }, actor, created.id, "done");
  assert.equal(completed.content.workflow_state, "done");
  assert.equal((await store.list({ DB }, actor)).length, 1);
  await store.remove({ DB }, actor, created.id);
  assert.equal((await store.list({ DB }, actor)).length, 0);
  DB.close();
});
