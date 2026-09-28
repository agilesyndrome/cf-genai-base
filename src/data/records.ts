import { AppDomain, type DomainRequestContext } from "../domain/index.js";
import type { AnyAppDomain } from "../app.js";
import type { DataActorContext } from "./model.js";
import { enumField, numberField, text, type AnyFieldDescriptor, type FieldDescriptor, type FieldOptions } from "./fields.js";

export interface VersionedOptions {
  publicRead?: boolean;
  readScope?: string;
  writeScope?: string;
  publishScope?: string;
}

export interface VersionedMixin {
  readonly kind: "versioned";
  readonly options: Readonly<VersionedOptions>;
}

export interface WorkflowOptions {
  states: readonly string[];
  initial?: string;
  transitions?: Readonly<Record<string, readonly string[]>>;
  field?: string;
}

export interface WorkflowMixin {
  readonly kind: "workflow";
  readonly options: Readonly<Required<Pick<WorkflowOptions, "states" | "initial" | "field">> & Pick<WorkflowOptions, "transitions">>;
  readonly fields: Readonly<Record<string, AnyFieldDescriptor>>;
}

export interface OpenStreetMapLocationOptions extends FieldOptions {}

export interface OpenStreetMapLocationMixin {
  readonly kind: "openStreetMapLocation";
  readonly fields: Readonly<Record<string, AnyFieldDescriptor>>;
}

export type RecordMixin = VersionedMixin | WorkflowMixin | OpenStreetMapLocationMixin;

export function versioned(options: VersionedOptions = {}): VersionedMixin {
  for (const scope of [options.readScope, options.writeScope, options.publishScope]) {
    if (scope && !/^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(scope)) throw new TypeError("Invalid record scope");
  }
  return Object.freeze({ kind: "versioned" as const, options: Object.freeze({ ...options }) });
}

export function workflow(options: WorkflowOptions): WorkflowMixin {
  const states = [...options.states];
  if (!states.length || new Set(states).size !== states.length || states.some((state) => !/^[a-z][a-z0-9_-]*$/.test(state))) {
    throw new TypeError("Workflow requires distinct safe states");
  }
  const initial = options.initial || states[0];
  if (!states.includes(initial)) throw new TypeError("Workflow initial state must be one of its states");
  const transitions = options.transitions ? Object.fromEntries(Object.entries(options.transitions).map(([from, to]) => [from, [...to]])) : undefined;
  if (transitions && Object.entries(transitions).some(([from, to]) => !states.includes(from) || to.some((state) => !states.includes(state)))) {
    throw new TypeError("Workflow transitions must reference known states");
  }
  const field = options.field || "workflow_state";
  if (!/^[a-z][a-z0-9_]*$/.test(field)) throw new TypeError("Workflow field must be a safe identifier");
  return Object.freeze({
    kind: "workflow" as const,
    options: Object.freeze({ states: Object.freeze(states), initial, transitions, field }),
    fields: Object.freeze({ [field]: enumField(states, { required: true }) }),
  });
}

export function openStreetMapLocation(options: OpenStreetMapLocationOptions = {}): OpenStreetMapLocationMixin {
  const required = options.required === true;
  return Object.freeze({
    kind: "openStreetMapLocation" as const,
    fields: Object.freeze({
      osm_type: text({ required }),
      osm_id: text({ required }),
      osm_latitude: numberField({ required }),
      osm_longitude: numberField({ required }),
    }),
  });
}

export type RecordValues<Fields extends Record<string, AnyFieldDescriptor>> = {
  [Key in keyof Fields]?: Fields[Key] extends FieldDescriptor<infer Value> ? Value : never;
};

export interface RecordDefinition<Fields extends Record<string, AnyFieldDescriptor> = Record<string, AnyFieldDescriptor>> {
  readonly name: string;
  readonly basePath: string;
  readonly fields: Readonly<Fields>;
  readonly mixins: readonly RecordMixin[];
  readonly versioned?: VersionedMixin;
  readonly workflow?: WorkflowMixin;
  readonly openStreetMapLocation?: OpenStreetMapLocationMixin;
}

export type AnyRecordDefinition = RecordDefinition<Record<string, AnyFieldDescriptor>>;

export interface RecordDefinitionInput<Fields extends Record<string, AnyFieldDescriptor>> {
  name: string;
  basePath?: string;
  fields: Fields;
  with: readonly RecordMixin[];
}

export function defineRecord<const Fields extends Record<string, AnyFieldDescriptor>>(
  input: RecordDefinitionInput<Fields>,
): Readonly<RecordDefinition<Fields>> {
  if (!/^[a-z][a-z0-9_-]*$/.test(input.name)) throw new TypeError("Records require a safe name");
  const basePath = input.basePath || `/api/${input.name}`;
  if (!/^\/api\/[a-z][a-z0-9_/-]*$/.test(basePath) || basePath.endsWith("/")) {
    throw new TypeError("Records require a fixed /api/ path");
  }
  const mixins = Object.freeze([...input.with]);
  const mixinFields = Object.fromEntries(mixins.flatMap((mixin) => Object.entries("fields" in mixin ? mixin.fields : {})));
  const collisions = Object.keys(input.fields).filter((key) => Object.hasOwn(mixinFields, key));
  if (collisions.length) throw new TypeError(`Record fields collide with mix-in fields: ${collisions.join(", ")}`);
  const fields = Object.freeze({ ...input.fields, ...mixinFields });
  if (!Object.keys(fields).length || Object.values(fields).some((field) => !field || typeof field.parse !== "function")) {
    throw new TypeError("Records require field descriptors");
  }
  const versionedMixin = mixins.filter((mixin): mixin is VersionedMixin => mixin.kind === "versioned");
  if (versionedMixin.length > 1) throw new TypeError(`Record ${input.name} may use versioned() only once`);
  const workflows = mixins.filter((mixin): mixin is WorkflowMixin => mixin.kind === "workflow");
  const locations = mixins.filter((mixin): mixin is OpenStreetMapLocationMixin => mixin.kind === "openStreetMapLocation");
  if (workflows.length > 1 || locations.length > 1) throw new TypeError(`Record ${input.name} may use workflow and OSM location only once`);
  return Object.freeze({ name: input.name, basePath, fields, mixins, versioned: versionedMixin[0], workflow: workflows[0], openStreetMapLocation: locations[0] });
}

export class RecordAccessError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

interface RecordEnvironment { DB?: D1Database }
interface RecordState { data: { context(): Promise<DataActorContext> } }
type RecordContext = DomainRequestContext<RecordEnvironment, RecordState>;

export type VersionedRecordDefinition<Fields extends Record<string, AnyFieldDescriptor> = Record<string, AnyFieldDescriptor>> = RecordDefinition<Fields> & { readonly versioned: VersionedMixin };

export class VersionedRecordStore<Fields extends Record<string, AnyFieldDescriptor> = Record<string, AnyFieldDescriptor>> {
  readonly definition: VersionedRecordDefinition<Fields>;

  constructor(definition: VersionedRecordDefinition<Fields>) { this.definition = definition; }

  async create(env: RecordEnvironment, actor: DataActorContext, value: unknown) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.versioned.options.writeScope);
    const id = crypto.randomUUID();
    const json = JSON.stringify(content(this.definition, value));
    const db = binding(env);
    await db.batch([
      db.prepare("INSERT INTO data_record_records (record_type, tenant_id, id, created_by) VALUES (?, ?, ?, ?)")
        .bind(this.definition.name, tenant, id, actor.userId),
      db.prepare("INSERT INTO data_record_versions (record_type, tenant_id, record_id, revision, content_json, saved_by) VALUES (?, ?, ?, 1, ?, ?)")
        .bind(this.definition.name, tenant, id, json, actor.userId),
    ]);
    return { id, revision: 1, content: JSON.parse(json) as RecordValues<Fields> };
  }

  async save(env: RecordEnvironment, actor: DataActorContext, id: string, expectedRevision: number, value: unknown) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.versioned.options.writeScope);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError("Expected revision is required");
    const current = await this.read(env, actor, id, true);
    if (!current) throw new RecordAccessError("Record not found", 404);
    const json = JSON.stringify(content(this.definition, value, current.content));
    const db = binding(env);
    const [insert, update] = await db.batch([
      db.prepare(`INSERT INTO data_record_versions (record_type, tenant_id, record_id, revision, content_json, saved_by)
        SELECT record_type, tenant_id, id, current_revision + 1, ?, ? FROM data_record_records
        WHERE record_type = ? AND tenant_id = ? AND id = ? AND current_revision = ?`)
        .bind(json, actor.userId, this.definition.name, tenant, id, expectedRevision),
      db.prepare(`UPDATE data_record_records SET current_revision = ?, updated_at = CURRENT_TIMESTAMP
        WHERE record_type = ? AND tenant_id = ? AND id = ? AND current_revision = ?
        AND EXISTS (SELECT 1 FROM data_record_versions WHERE record_type = ? AND tenant_id = ? AND record_id = ? AND revision = ?)`)
        .bind(expectedRevision + 1, this.definition.name, tenant, id, expectedRevision,
          this.definition.name, tenant, id, expectedRevision + 1),
    ]);
    if (!insert.meta?.changes || !update.meta?.changes) throw new RecordAccessError("Revision conflict or record not found", 409);
    return { id, revision: expectedRevision + 1, content: JSON.parse(json) as RecordValues<Fields> };
  }

  async publish(env: RecordEnvironment, actor: DataActorContext, id: string, revision: number) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.versioned.options.publishScope || this.definition.versioned.options.writeScope);
    if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError("Valid revision is required");
    const result = await binding(env).prepare(`UPDATE data_record_records SET published_revision = ?, updated_at = CURRENT_TIMESTAMP
      WHERE record_type = ? AND tenant_id = ? AND id = ? AND current_revision >= ?
      AND EXISTS (SELECT 1 FROM data_record_versions WHERE record_type = ? AND tenant_id = ? AND record_id = ? AND revision = ?)`)
      .bind(revision, this.definition.name, tenant, id, revision, this.definition.name, tenant, id, revision).run();
    if (!result.meta?.changes) throw new RecordAccessError("Record or revision not found", 404);
    return { id, publishedRevision: revision };
  }

  async unpublish(env: RecordEnvironment, actor: DataActorContext, id: string) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.versioned.options.publishScope || this.definition.versioned.options.writeScope);
    const result = await binding(env).prepare("UPDATE data_record_records SET published_revision = NULL, updated_at = CURRENT_TIMESTAMP WHERE record_type = ? AND tenant_id = ? AND id = ?")
      .bind(this.definition.name, tenant, id).run();
    if (!result.meta?.changes) throw new RecordAccessError("Record not found", 404);
    return { id, publishedRevision: null };
  }

  async list(env: RecordEnvironment, actor: DataActorContext) {
    if (actor.invalidTenant || (actor.userId && !actor.tenantId)) throw new RecordAccessError("Choose a tenant you belong to", 403);
    const tenant = actor.tenantId || actor.publicTenantId;
    if (!tenant || (!actor.userId && !this.definition.versioned.options.publicRead)) return [];
    if (actor.userId) requireScope(actor, this.definition.versioned.options.readScope);
    const result = await binding(env).prepare(`SELECT r.id, v.revision, v.content_json FROM data_record_records r
      JOIN data_record_versions v ON v.record_type = r.record_type AND v.tenant_id = r.tenant_id
      AND v.record_id = r.id AND v.revision = r.published_revision
      WHERE r.record_type = ? AND r.tenant_id = ? ORDER BY r.id LIMIT 100`)
      .bind(this.definition.name, tenant).all<{ id: string; revision: number; content_json: string }>();
    return (result.results || []).map((row) => ({ id: row.id, revision: row.revision, content: JSON.parse(row.content_json) as RecordValues<Fields> }));
  }

  async read(env: RecordEnvironment, actor: DataActorContext, id: string, draft = false) {
    if (actor.invalidTenant || (actor.userId && !actor.tenantId)) throw new RecordAccessError("Choose a tenant you belong to", 403);
    const tenant = draft ? ownTenant(actor) : actor.tenantId || actor.publicTenantId;
    if (!tenant || (!draft && !actor.userId && !this.definition.versioned.options.publicRead)) return null;
    if (draft || actor.userId) requireScope(actor, this.definition.versioned.options.readScope);
    const column = draft ? "current_revision" : "published_revision";
    const row = await binding(env).prepare(`SELECT r.id, v.revision, v.content_json FROM data_record_records r
      JOIN data_record_versions v ON v.record_type = r.record_type AND v.tenant_id = r.tenant_id
      AND v.record_id = r.id AND v.revision = r.${column}
      WHERE r.record_type = ? AND r.tenant_id = ? AND r.id = ?`)
      .bind(this.definition.name, tenant, id).first<{ id: string; revision: number; content_json: string }>();
    return row && { id: row.id, revision: row.revision, content: JSON.parse(row.content_json) as RecordValues<Fields> };
  }

  async versions(env: RecordEnvironment, actor: DataActorContext, id: string) {
    const tenant = ownTenant(actor);
    requireScope(actor, this.definition.versioned.options.readScope);
    const result = await binding(env).prepare(`SELECT v.revision, v.content_json, v.saved_by, v.saved_at FROM data_record_versions v
      WHERE v.record_type = ? AND v.tenant_id = ? AND v.record_id = ? ORDER BY v.revision DESC LIMIT 100`)
      .bind(this.definition.name, tenant, id).all<{ revision: number; content_json: string; saved_by: string; saved_at: string }>();
    return (result.results || []).map((row) => ({ revision: row.revision, content: JSON.parse(row.content_json) as RecordValues<Fields>, savedBy: row.saved_by, savedAt: row.saved_at }));
  }

  async transition(env: RecordEnvironment, actor: DataActorContext, id: string, expectedRevision: number, state: string) {
    if (!this.definition.workflow) throw new RecordAccessError("Workflow is not enabled", 404);
    const current = await this.read(env, actor, id, true);
    if (!current) throw new RecordAccessError("Record not found", 404);
    return this.save(env, actor, id, expectedRevision, { ...current.content, [this.definition.workflow.options.field]: state });
  }
}

export class RecordStore<Fields extends Record<string, AnyFieldDescriptor> = Record<string, AnyFieldDescriptor>> {
  readonly definition: RecordDefinition<Fields>;

  constructor(definition: RecordDefinition<Fields>) { this.definition = definition; }

  async create(env: RecordEnvironment, actor: DataActorContext, value: unknown) {
    const tenant = ownTenant(actor);
    const id = crypto.randomUUID();
    const json = JSON.stringify(content(this.definition, value));
    await binding(env).prepare("INSERT INTO data_records (record_type, tenant_id, id, content_json, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(this.definition.name, tenant, id, json, actor.userId).run();
    return { id, content: JSON.parse(json) as RecordValues<Fields> };
  }

  async list(env: RecordEnvironment, actor: DataActorContext) {
    const tenant = ownTenant(actor);
    const result = await binding(env).prepare("SELECT id, content_json FROM data_records WHERE record_type = ? AND tenant_id = ? ORDER BY id LIMIT 100")
      .bind(this.definition.name, tenant).all<{ id: string; content_json: string }>();
    return (result.results || []).map((row) => ({ id: row.id, content: JSON.parse(row.content_json) as RecordValues<Fields> }));
  }

  async read(env: RecordEnvironment, actor: DataActorContext, id: string) {
    const tenant = ownTenant(actor);
    const row = await binding(env).prepare("SELECT id, content_json FROM data_records WHERE record_type = ? AND tenant_id = ? AND id = ?")
      .bind(this.definition.name, tenant, id).first<{ id: string; content_json: string }>();
    return row && { id: row.id, content: JSON.parse(row.content_json) as RecordValues<Fields> };
  }

  async update(env: RecordEnvironment, actor: DataActorContext, id: string, value: unknown) {
    const current = await this.read(env, actor, id);
    if (!current) throw new RecordAccessError("Record not found", 404);
    const json = JSON.stringify(content(this.definition, value, current.content));
    const result = await binding(env).prepare("UPDATE data_records SET content_json = ?, updated_at = CURRENT_TIMESTAMP WHERE record_type = ? AND tenant_id = ? AND id = ?")
      .bind(json, this.definition.name, actor.tenantId, id).run();
    if (!result.meta?.changes) throw new RecordAccessError("Record not found", 404);
    return { id, content: JSON.parse(json) as RecordValues<Fields> };
  }

  async remove(env: RecordEnvironment, actor: DataActorContext, id: string) {
    const result = await binding(env).prepare("DELETE FROM data_records WHERE record_type = ? AND tenant_id = ? AND id = ?")
      .bind(this.definition.name, actor.tenantId, id).run();
    if (!result.meta?.changes) throw new RecordAccessError("Record not found", 404);
    return { id };
  }

  async transition(env: RecordEnvironment, actor: DataActorContext, id: string, state: string) {
    const current = await this.read(env, actor, id);
    if (!current) throw new RecordAccessError("Record not found", 404);
    return this.update(env, actor, id, { ...current.content, [this.definition.workflow?.options.field || "workflow_state"]: state });
  }
}

export class RecordDomain extends AppDomain {
  readonly store: VersionedRecordStore | RecordStore;

  constructor(definition: AnyRecordDefinition) {
    const store = definition.versioned ? new VersionedRecordStore(definition as VersionedRecordDefinition) : new RecordStore(definition);
    const readAuth = definition.versioned?.options.publicRead ? "public" : "user";
    super({ name: `records.${definition.name}`, basePath: definition.basePath, auth: readAuth });
    this.store = store;
    const actor = (context: RecordContext) => context.state.data.context();
    this.route({ method: "GET", auth: readAuth, handler: (context: RecordContext) => respond(async () => ({ records: await store.list(context.env, await actor(context)) })) });
    this.route({ method: "POST", csrf: true, handler: (context: RecordContext) => respond(async () => store.create(context.env, await actor(context), (await body(context.request)).content), 201) });
    if (definition.versioned) {
      const versionedStore = store as VersionedRecordStore;
      this.route({ method: "PUT", path: "/:id", csrf: true, handler: (context: RecordContext) => respond(async () => {
        const input = await body(context.request);
        return versionedStore.save(context.env, await actor(context), context.params.id, Number(input.expectedRevision), input.content);
      }) });
      this.addVersionedRoutes(versionedStore, definition, actor);
    } else {
      const recordStore = store as RecordStore;
      this.route({ method: "PUT", path: "/:id", csrf: true, handler: (context: RecordContext) => respond(async () => recordStore.update(context.env, await actor(context), context.params.id, (await body(context.request)).content)) });
      this.route({ method: "DELETE", path: "/:id", csrf: true, handler: (context: RecordContext) => respond(async () => recordStore.remove(context.env, await actor(context), context.params.id)) });
    }
    if (definition.workflow) {
      this.route({ method: "POST", path: "/:id/workflow", csrf: true, handler: (context: RecordContext) => respond(async () => {
        const input = await body(context.request);
        return definition.versioned
          ? (store as VersionedRecordStore).transition(context.env, await actor(context), context.params.id, Number(input.expectedRevision), String(input.state || ""))
          : (store as RecordStore).transition(context.env, await actor(context), context.params.id, String(input.state || ""));
      }) });
    }
    this.route({ method: "GET", path: "/:id", auth: readAuth, handler: (context: RecordContext) => respond(async () => {
      const result = await store.read(context.env, await actor(context), context.params.id, ...(definition.versioned ? [false] : []));
      if (!result) throw new RecordAccessError("Record not found", 404);
      return result;
    }) });
  }

  private addVersionedRoutes(store: VersionedRecordStore, definition: AnyRecordDefinition, actor: (context: RecordContext) => Promise<DataActorContext>): void {
    this.route({ method: "POST", path: "/:id/publish", csrf: true, handler: (context: RecordContext) => respond(async () => store.publish(context.env, await actor(context), context.params.id, Number((await body(context.request)).revision))) });
    this.route({ method: "DELETE", path: "/:id/publish", csrf: true, handler: (context: RecordContext) => respond(async () => store.unpublish(context.env, await actor(context), context.params.id)) });
    this.route({ method: "GET", path: "/:id/versions", handler: (context: RecordContext) => respond(async () => store.versions(context.env, await actor(context), context.params.id)) });
    this.route({ method: "GET", path: "/:id/draft", handler: (context: RecordContext) => respond(async () => {
      const result = await store.read(context.env, await actor(context), context.params.id, true);
      if (!result) throw new RecordAccessError("Record not found", 404);
      return result;
    }) });
  }
}

export function createRecordDomains(records: readonly AnyRecordDefinition[] = []): readonly AnyAppDomain[] {
  return records.map((record) => new RecordDomain(record));
}

function content<Fields extends Record<string, AnyFieldDescriptor>>(definition: RecordDefinition<Fields>, value: unknown, previous?: Record<string, unknown>): RecordValues<Fields> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Record content must be an object");
  const source = { ...(value as Record<string, unknown>) };
  if (definition.workflow && source[definition.workflow.options.field] === undefined) {
    source[definition.workflow.options.field] = previous?.[definition.workflow.options.field] ?? definition.workflow.options.initial;
  }
  if (definition.workflow && previous) {
    const field = definition.workflow.options.field;
    const before = previous[field];
    const after = source[field];
    if (before !== after && definition.workflow.options.transitions) {
      const allowed = definition.workflow.options.transitions[String(before)] || [];
      if (!allowed.includes(String(after))) throw new TypeError(`Workflow cannot transition from ${String(before)} to ${String(after)}`);
    }
  }
  if (definition.openStreetMapLocation) {
    const osmKeys = ["osm_type", "osm_id", "osm_latitude", "osm_longitude"];
    const supplied = osmKeys.filter((key) => source[key] !== undefined);
    if (supplied.length > 0 && supplied.length < osmKeys.length) {
      throw new TypeError("OpenStreetMap locations require type, id, latitude, and longitude together");
    }
    if (source.osm_type !== undefined && !["node", "way", "relation"].includes(String(source.osm_type))) {
      throw new TypeError("OpenStreetMap type must be node, way, or relation");
    }
    if (source.osm_latitude !== undefined && (Number(source.osm_latitude) < -90 || Number(source.osm_latitude) > 90)) {
      throw new TypeError("OpenStreetMap latitude must be between -90 and 90");
    }
    if (source.osm_longitude !== undefined && (Number(source.osm_longitude) < -180 || Number(source.osm_longitude) > 180)) {
      throw new TypeError("OpenStreetMap longitude must be between -180 and 180");
    }
  }
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    const field = definition.fields[key];
    if (!field) throw new TypeError(`Unknown record field: ${key}`);
    const parsed = field.parse(source[key], key);
    if (parsed !== undefined) result[key] = parsed;
  }
  for (const [key, field] of Object.entries(definition.fields)) {
    if (field.required && !Object.hasOwn(source, key)) throw new TypeError(`Required record field: ${key}`);
  }
  return result as RecordValues<Fields>;
}

function binding(env: RecordEnvironment): D1Database {
  if (!env.DB) throw new Error("Records require a DB binding");
  return env.DB;
}

function ownTenant(actor: DataActorContext): string {
  if (!actor.userId || !actor.tenantId || actor.invalidTenant) throw new RecordAccessError("Choose a tenant you belong to", 403);
  return actor.tenantId;
}

function requireScope(actor: DataActorContext, scope?: string): void {
  if (scope && !actor.system && !actor.scopes?.includes(scope)) throw new RecordAccessError("Missing record scope", 403);
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
    if (error instanceof RecordAccessError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof TypeError || error instanceof SyntaxError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
