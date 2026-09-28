import { AppDomain, type DomainRequestContext } from "../domain/index.js";
import { ObjectEngagementStore, type EngagementInput } from "./engagement.js";
import type { DataActorContext } from "./model.js";

export type ObjectFieldType = "string" | "number" | "boolean";
export type ObjectContent = Record<string, string | number | boolean>;
export interface VersionedObjectInput extends EngagementInput {
  name: string;
  basePath: string;
  fields: Record<string, ObjectFieldType>;
  publicRead?: boolean;
  readScope?: string;
  writeScope?: string;
  publishScope?: string;
}

export interface VersionedObjectDefinition extends VersionedObjectInput {
  publicRead: boolean;
}

interface ObjectEnvironment { DB?: D1Database }
interface ObjectState { data: { context(): Promise<DataActorContext> } }
type Context = DomainRequestContext<ObjectEnvironment, ObjectState>;

/** A model definition is fixed at composition time; callers cannot change its SQL identifiers. */
export function defineVersionedObject(input: VersionedObjectInput): VersionedObjectDefinition {
  if (!/^[a-z][a-z0-9_-]*$/.test(input.name)) throw new TypeError("Invalid object name");
  if (!/^\/api\/[a-z][a-z0-9_/-]*$/.test(input.basePath) || input.basePath.endsWith("/")) {
    throw new TypeError("Versioned objects require a fixed /api/ path");
  }
  if (!Object.keys(input.fields).length || Object.entries(input.fields).some(([key, type]) =>
    !/^[a-z][a-z0-9_]*$/.test(key) || !["string", "number", "boolean"].includes(type)
  )) throw new TypeError("Versioned objects require typed fields");
  for (const scope of [input.readScope, input.writeScope, input.publishScope]) {
    if (scope && !/^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(scope)) throw new TypeError("Invalid object scope");
  }
  return Object.freeze({ ...input, fields: Object.freeze({ ...input.fields }), publicRead: input.publicRead === true });
}

function content(definition: VersionedObjectDefinition, value: unknown): ObjectContent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Content must be an object");
  const result: Record<string, string | number | boolean> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!Object.hasOwn(definition.fields, key) || typeof field !== definition.fields[key]
      || (typeof field === "number" && !Number.isFinite(field))) throw new TypeError(`Invalid field: ${key}`);
    result[key] = field as string | number | boolean;
  }
  return result;
}

function binding(env: ObjectEnvironment): D1Database {
  if (!env.DB) throw new Error("Versioned objects require a DB binding");
  return env.DB;
}

function ownTenant(actor: DataActorContext): string {
  if (!actor.userId || !actor.tenantId || actor.invalidTenant) throw new ObjectAccessError("Choose a tenant you belong to", 403);
  return actor.tenantId;
}

function requireScope(actor: DataActorContext, scope?: string): void {
  if (scope && !actor.system && !actor.scopes?.includes(scope)) throw new ObjectAccessError("Missing object scope", 403);
}

export class ObjectAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** All managed writes pass through this service; generic repository writes cannot skip snapshots. */
export class VersionedObjectStore {
  readonly definition: VersionedObjectDefinition;
  constructor(input: VersionedObjectInput) { this.definition = defineVersionedObject(input); }

  async create(env: ObjectEnvironment, actor: DataActorContext, value: unknown) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.writeScope);
    const id = crypto.randomUUID();
    const json = JSON.stringify(content(this.definition, value));
    const db = binding(env);
    // D1 batch commits the identity and first immutable snapshot together.
    await db.batch([
      db.prepare("INSERT INTO data_object_records (object_type, tenant_id, id, created_by) VALUES (?, ?, ?, ?)")
        .bind(this.definition.name, tenant, id, actor.userId),
      db.prepare("INSERT INTO data_object_versions (object_type, tenant_id, record_id, revision, content_json, saved_by) VALUES (?, ?, ?, 1, ?, ?)")
        .bind(this.definition.name, tenant, id, json, actor.userId),
    ]);
    return { id, revision: 1, content: JSON.parse(json) as ObjectContent };
  }

  async save(env: ObjectEnvironment, actor: DataActorContext, id: string, expectedRevision: number, value: unknown) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.writeScope);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError("Expected revision is required");
    const json = JSON.stringify(content(this.definition, value));
    const db = binding(env);
    // The unique revision key arbitrates competing editors. Both statements roll back on SQL error.
    const [insert, update] = await db.batch([
      db.prepare(`INSERT INTO data_object_versions (object_type, tenant_id, record_id, revision, content_json, saved_by)
        SELECT object_type, tenant_id, id, current_revision + 1, ?, ? FROM data_object_records
        WHERE object_type = ? AND tenant_id = ? AND id = ? AND current_revision = ?`)
        .bind(json, actor.userId, this.definition.name, tenant, id, expectedRevision),
      db.prepare(`UPDATE data_object_records SET current_revision = ?, updated_at = CURRENT_TIMESTAMP
        WHERE object_type = ? AND tenant_id = ? AND id = ? AND current_revision = ?
        AND EXISTS (SELECT 1 FROM data_object_versions WHERE object_type = ? AND tenant_id = ? AND record_id = ? AND revision = ?)`)
        .bind(expectedRevision + 1, this.definition.name, tenant, id, expectedRevision,
          this.definition.name, tenant, id, expectedRevision + 1),
    ]);
    if (!insert.meta?.changes || !update.meta?.changes) throw new ObjectAccessError("Revision conflict or object not found", 409);
    return { id, revision: expectedRevision + 1, content: JSON.parse(json) as ObjectContent };
  }

  async publish(env: ObjectEnvironment, actor: DataActorContext, id: string, revision: number) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.publishScope || this.definition.writeScope);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("Valid revision is required");
    const result = await binding(env).prepare(`UPDATE data_object_records SET published_revision = ?, updated_at = CURRENT_TIMESTAMP
      WHERE object_type = ? AND tenant_id = ? AND id = ? AND current_revision >= ?
      AND EXISTS (SELECT 1 FROM data_object_versions WHERE object_type = ? AND tenant_id = ? AND record_id = ? AND revision = ?)`)
      .bind(revision, this.definition.name, tenant, id, revision, this.definition.name, tenant, id, revision).run();
    if (!result.meta?.changes) throw new ObjectAccessError("Object or revision not found", 404);
    return { id, publishedRevision: revision };
  }

  async unpublish(env: ObjectEnvironment, actor: DataActorContext, id: string) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.publishScope || this.definition.writeScope);
    const result = await binding(env).prepare(`UPDATE data_object_records
      SET published_revision = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE object_type = ? AND tenant_id = ? AND id = ?`)
      .bind(this.definition.name, tenant, id).run();
    if (!result.meta?.changes) throw new ObjectAccessError("Object not found", 404);
    return { id, publishedRevision: null };
  }

  async list(env: ObjectEnvironment, actor: DataActorContext) {
    if (actor.invalidTenant || (actor.userId && !actor.tenantId)) throw new ObjectAccessError("Choose a tenant you belong to", 403);
    const tenant = actor.tenantId || actor.publicTenantId;
    if (!tenant || (!actor.userId && !this.definition.publicRead)) return [];
    const result = await binding(env).prepare(`SELECT r.id, v.revision, v.content_json FROM data_object_records r
      JOIN data_object_versions v ON v.object_type = r.object_type AND v.tenant_id = r.tenant_id
      AND v.record_id = r.id AND v.revision = r.published_revision
      WHERE r.object_type = ? AND r.tenant_id = ? ORDER BY r.id LIMIT 100`)
      .bind(this.definition.name, tenant).all<{ id: string; revision: number; content_json: string }>();
    return (result.results || []).map((row) => ({ id: row.id, revision: row.revision, content: JSON.parse(row.content_json) as ObjectContent }));
  }

  async read(env: ObjectEnvironment, actor: DataActorContext, id: string, draft = false) {
    if (actor.invalidTenant || (actor.userId && !actor.tenantId)) throw new ObjectAccessError("Choose a tenant you belong to", 403);
    const tenant = draft ? ownTenant(actor) : actor.tenantId || actor.publicTenantId;
    if (!tenant || (!draft && !actor.userId && !this.definition.publicRead)) return null;
    if (draft) requireScope(actor, this.definition.readScope);
    const column = draft ? "current_revision" : "published_revision";
    const row = await binding(env).prepare(`SELECT r.id, v.revision, v.content_json FROM data_object_records r
      JOIN data_object_versions v ON v.object_type = r.object_type AND v.tenant_id = r.tenant_id
      AND v.record_id = r.id AND v.revision = r.${column}
      WHERE r.object_type = ? AND r.tenant_id = ? AND r.id = ?`)
      .bind(this.definition.name, tenant, id).first<{ id: string; revision: number; content_json: string }>();
    return row && { id: row.id, revision: row.revision, content: JSON.parse(row.content_json) as ObjectContent };
  }

  async versions(env: ObjectEnvironment, actor: DataActorContext, id: string) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.readScope);
    const result = await binding(env).prepare(`SELECT v.revision, v.content_json, v.saved_by, v.saved_at
      FROM data_object_versions v WHERE v.object_type = ? AND v.tenant_id = ? AND v.record_id = ?
      ORDER BY v.revision DESC LIMIT 100`).bind(this.definition.name, tenant, id)
      .all<{ revision: number; content_json: string; saved_by: string; saved_at: string }>();
    return (result.results || []).map((row) => ({ revision: row.revision, content: JSON.parse(row.content_json) as ObjectContent, savedBy: row.saved_by, savedAt: row.saved_at }));
  }
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new TypeError("JSON body required");
  const parsed: unknown = await request.json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("JSON object required");
  return parsed as Record<string, unknown>;
}

async function respond(action: () => Promise<unknown>, status = 200): Promise<Response> {
  try { return Response.json(await action(), { status }); }
  catch (error) {
    if (error instanceof ObjectAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof TypeError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** Register the conventional handlers without giving callers a bypass around the model service. */
export class VersionedObjectDomain extends AppDomain {
  readonly store: VersionedObjectStore;
  readonly engagement: ObjectEngagementStore | null;
  constructor(input: VersionedObjectInput) {
    const store = new VersionedObjectStore(input);
    const engagement = input.passport || input.ratings ? new ObjectEngagementStore(store, input) : null;
    // Reads are safe cross-origin methods; only mutations need the origin guard.
    super({ name: `objects.${store.definition.name}`, basePath: input.basePath, auth: "user" });
    this.store = store;
    this.engagement = engagement;
    const actor = (context: Context) => context.state.data.context();
    const offset = (context: Context) => Number(new URL(context.request.url).searchParams.get("offset") || 0);
    if (engagement) {
      this.route({ method: "GET", path: "/passport", handler: (c: Context) => respond(async () =>
        ({ stamps: await engagement.myPassports(c.env, await actor(c), offset(c)) })) });
      this.route({ method: "PUT", path: "/:id/passport", csrf: true, handler: (c: Context) => respond(async () =>
        engagement.stamp(c.env, await actor(c), c.params.id, (await body(c.request)).visibility)) });
      this.route({ method: "GET", path: "/:id/passport", handler: (c: Context) => respond(async () => {
        const result = await engagement.mine(c.env, await actor(c), c.params.id, offset(c));
        if (!result) throw new ObjectAccessError("Stamp not found", 404);
        return result;
      }) });
      this.route({ method: "GET", path: "/:id/passports", auth: "public", handler: (c: Context) => respond(async () =>
        ({ stamps: await engagement.visible(c.env, await actor(c), c.params.id, "passports", offset(c)) })) });
      if (engagement.ratings) {
        this.route({ method: "POST", path: "/:id/ratings", csrf: true, handler: (c: Context) => respond(async () => {
          const input = await body(c.request);
          return engagement.rate(c.env, await actor(c), c.params.id, input.value, input.visibility);
        }, 201) });
        this.route({ method: "GET", path: "/:id/ratings", auth: "public", handler: (c: Context) => respond(async () =>
          ({ ratings: await engagement.visible(c.env, await actor(c), c.params.id, "ratings", offset(c)) })) });
      }
    }
    this.route({ method: "GET", auth: "public", handler: (c: Context) => respond(async () =>
      ({ records: await store.list(c.env, await actor(c)) })) });
    this.route({ method: "POST", csrf: true, handler: (c: Context) => respond(async () => store.create(c.env, await actor(c), (await body(c.request)).content), 201) });
    this.route({ method: "PUT", path: "/:id", csrf: true, handler: (c: Context) => respond(async () => {
      const input = await body(c.request);
      return store.save(c.env, await actor(c), c.params.id, Number(input.expectedRevision), input.content);
    }) });
    this.route({ method: "POST", path: "/:id/publish", csrf: true, handler: (c: Context) => respond(async () =>
      store.publish(c.env, await actor(c), c.params.id, Number((await body(c.request)).revision))) });
    this.route({ method: "DELETE", path: "/:id/publish", csrf: true, handler: (c: Context) => respond(async () =>
      store.unpublish(c.env, await actor(c), c.params.id)) });
    this.route({ method: "GET", path: "/:id/versions", handler: (c: Context) => respond(async () =>
      ({ versions: await store.versions(c.env, await actor(c), c.params.id) })) });
    this.route({ method: "GET", path: "/:id/draft", handler: (c: Context) => respond(async () => {
      const result = await store.read(c.env, await actor(c), c.params.id, true);
      if (!result) throw new ObjectAccessError("Not found", 404);
      return result;
    }) });
    this.route({ method: "GET", path: "/:id", auth: "public", handler: (c: Context) => respond(async () => {
      const result = await store.read(c.env, await actor(c), c.params.id);
      if (!result) throw new ObjectAccessError("Not found", 404);
      return result;
    }) });
  }
}
