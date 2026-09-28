import type { DataActorContext } from "./model.js";
import { ObjectAccessError, type VersionedObjectStore } from "./objects.js";

export type EngagementVisibility = "private" | "tenant" | "public";
export interface EngagementPolicyInput {
  maximum: EngagementVisibility;
  default?: EngagementVisibility;
  userChoice?: boolean;
  scope?: string;
}
export interface RatingPolicyInput extends EngagementPolicyInput {
  scale: readonly string[];
}
export interface EngagementInput {
  passport?: EngagementPolicyInput;
  ratings?: RatingPolicyInput;
}

interface Policy extends EngagementPolicyInput { default: EngagementVisibility; userChoice: boolean }
interface RatingPolicy extends Policy { scale: readonly string[] }
interface ObjectEnvironment { DB?: D1Database }
const levels: readonly EngagementVisibility[] = ["private", "tenant", "public"];

function normalize(policy: EngagementPolicyInput, publicRead: boolean): Policy {
  const fallback = policy.default || "private";
  if (!levels.includes(policy.maximum) || !levels.includes(fallback) || levels.indexOf(fallback) > levels.indexOf(policy.maximum)) {
    throw new TypeError("Invalid engagement visibility policy");
  }
  if (policy.maximum === "public" && !publicRead) throw new TypeError("Public engagement requires public object reads");
  if (policy.scope && !/^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(policy.scope)) throw new TypeError("Invalid engagement scope");
  return Object.freeze({ ...policy, default: fallback, userChoice: policy.userChoice === true });
}

function chosen(policy: Policy, requested: unknown): EngagementVisibility {
  if (requested === undefined) return policy.default;
  if (!levels.includes(requested as EngagementVisibility)
    || levels.indexOf(requested as EngagementVisibility) > levels.indexOf(policy.maximum)
    || (!policy.userChoice && requested !== policy.default)) throw new TypeError("Visibility is not permitted");
  return requested as EngagementVisibility;
}

function tenant(actor: DataActorContext, policy?: Policy): string {
  if (!actor.userId || !actor.tenantId || actor.invalidTenant) throw new ObjectAccessError("Choose a tenant you belong to", 403);
  if (policy?.scope && !actor.system && !actor.scopes?.includes(policy.scope)) throw new ObjectAccessError("Missing engagement scope", 403);
  return actor.tenantId;
}

function db(env: ObjectEnvironment): D1Database {
  if (!env.DB) throw new Error("Object engagement requires a DB binding");
  return env.DB;
}

function pageOffset(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) throw new TypeError("Invalid page offset");
  return value;
}

/** Ratings imply a passport, so repeated ratings share one personal stamp. */
export class ObjectEngagementStore {
  readonly object: VersionedObjectStore;
  readonly passport: Policy;
  readonly ratings: RatingPolicy | null;
  readonly passportEnabled: boolean;

  constructor(object: VersionedObjectStore, input: EngagementInput) {
    this.object = object;
    this.passportEnabled = Boolean(input.passport || input.ratings);
    this.passport = normalize(input.passport || { maximum: "private" }, object.definition.publicRead);
    this.ratings = input.ratings ? Object.freeze({
      ...normalize(input.ratings, object.definition.publicRead),
      scale: Object.freeze([...input.ratings.scale]),
    }) : null;
    if (this.ratings && (this.ratings.scale.length < 2 || new Set(this.ratings.scale).size !== this.ratings.scale.length
      || this.ratings.scale.some((value) => typeof value !== "string" || !value.trim() || value.length > 80))) {
      throw new TypeError("Ratings require a distinct, ordered scale of at least two values");
    }
  }

  async stamp(env: ObjectEnvironment, actor: DataActorContext, id: string, visibility?: unknown) {
    const tenantId = tenant(actor, this.passport);
    const selected = chosen(this.passport, visibility);
    // The SELECT prevents stamps on missing, cross-tenant, or unpublished objects.
    const result = await db(env).prepare(`INSERT INTO data_object_passports
      (object_type, tenant_id, record_id, user_id, visibility)
      SELECT object_type, tenant_id, id, ?, ? FROM data_object_records
      WHERE object_type = ? AND tenant_id = ? AND id = ? AND published_revision IS NOT NULL
      ON CONFLICT(object_type, tenant_id, record_id, user_id)
      DO UPDATE SET visibility = excluded.visibility, updated_at = CURRENT_TIMESTAMP`)
      .bind(actor.userId, selected, this.object.definition.name, tenantId, id).run();
    if (!result.meta?.changes) throw new ObjectAccessError("Published object not found", 404);
    return { id, visibility: selected };
  }

  async rate(env: ObjectEnvironment, actor: DataActorContext, id: string, value: unknown, visibility?: unknown) {
    if (!this.ratings) throw new ObjectAccessError("Ratings are disabled", 404);
    const tenantId = tenant(actor, this.ratings);
    if (typeof value !== "string" || !this.ratings.scale.includes(value)) throw new TypeError("Value is outside the rating scale");
    const selected = chosen(this.ratings, visibility);
    const ratingId = crypto.randomUUID();
    const database = db(env);
    // The stamp is idempotent; each rating is a new event tied to the currently published revision.
    const [, rated] = await database.batch([
      database.prepare(`INSERT INTO data_object_passports
        (object_type, tenant_id, record_id, user_id, visibility)
        SELECT object_type, tenant_id, id, ?, ? FROM data_object_records
        WHERE object_type = ? AND tenant_id = ? AND id = ? AND published_revision IS NOT NULL
        ON CONFLICT(object_type, tenant_id, record_id, user_id) DO NOTHING`)
        .bind(actor.userId, this.passport.default, this.object.definition.name, tenantId, id),
      database.prepare(`INSERT INTO data_object_ratings
        (id, object_type, tenant_id, record_id, user_id, revision, value, visibility)
        SELECT ?, object_type, tenant_id, id, ?, published_revision, ?, ? FROM data_object_records
        WHERE object_type = ? AND tenant_id = ? AND id = ? AND published_revision IS NOT NULL`)
        .bind(ratingId, actor.userId, value, selected, this.object.definition.name, tenantId, id),
    ]);
    if (!rated.meta?.changes) throw new ObjectAccessError("Published object not found", 404);
    return { id: ratingId, recordId: id, value, visibility: selected };
  }

  async mine(env: ObjectEnvironment, actor: DataActorContext, id: string, offset = 0) {
    const tenantId = tenant(actor);
    pageOffset(offset);
    const passport = await db(env).prepare(`SELECT visibility, stamped_at, updated_at FROM data_object_passports
      WHERE object_type = ? AND tenant_id = ? AND record_id = ? AND user_id = ?`)
      .bind(this.object.definition.name, tenantId, id, actor.userId)
      .first<{ visibility: EngagementVisibility; stamped_at: string; updated_at: string }>();
    if (!passport) return null;
    const ratings = this.ratings ? await db(env).prepare(`SELECT id, revision, value, visibility, rated_at
      FROM data_object_ratings WHERE object_type = ? AND tenant_id = ? AND record_id = ? AND user_id = ?
      ORDER BY rated_at DESC, id DESC LIMIT 100 OFFSET ?`)
      .bind(this.object.definition.name, tenantId, id, actor.userId, offset)
      .all<{ id: string; revision: number; value: string; visibility: EngagementVisibility; rated_at: string }>() : null;
    return { recordId: id, visibility: passport.visibility, stampedAt: passport.stamped_at,
      updatedAt: passport.updated_at, ratings: ratings?.results || [] };
  }

  async myPassports(env: ObjectEnvironment, actor: DataActorContext, offset = 0) {
    const tenantId = tenant(actor);
    pageOffset(offset);
    const result = await db(env).prepare(`SELECT record_id, visibility, stamped_at FROM data_object_passports
      WHERE object_type = ? AND tenant_id = ? AND user_id = ? ORDER BY stamped_at DESC, record_id LIMIT 100 OFFSET ?`)
      .bind(this.object.definition.name, tenantId, actor.userId, offset)
      .all<{ record_id: string; visibility: EngagementVisibility; stamped_at: string }>();
    return (result.results || []).map((row) => ({ recordId: row.record_id, visibility: row.visibility, stampedAt: row.stamped_at }));
  }

  async visible(env: ObjectEnvironment, actor: DataActorContext, id: string, kind: "passports" | "ratings", offset = 0) {
    pageOffset(offset);
    if (!await this.object.read(env, actor, id)) throw new ObjectAccessError("Published object not found", 404);
    const tenantId = actor.tenantId || actor.publicTenantId;
    const member = Boolean(actor.userId && actor.tenantId);
    const table = kind === "ratings" ? "data_object_ratings" : "data_object_passports";
    const columns = kind === "ratings"
      ? "id, user_id, revision, value, rated_at"
      : "user_id, stamped_at";
    // Ownership, authenticated tenant membership, and public visibility are disjoint grants.
    const result = await db(env).prepare(`SELECT ${columns} FROM ${table}
      WHERE object_type = ? AND tenant_id = ? AND record_id = ?
      AND (visibility = 'public' OR (visibility = 'tenant' AND ? = 1) OR user_id = ?)
      ORDER BY ${kind === "ratings" ? "rated_at DESC, id" : "stamped_at DESC, user_id"} DESC LIMIT 100 OFFSET ?`)
      .bind(this.object.definition.name, tenantId, id, member ? 1 : 0, actor.userId || "", offset)
      .all<Record<string, unknown>>();
    return result.results || [];
  }
}
