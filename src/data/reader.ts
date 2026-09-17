import { createD1, type D1Environment } from "../core/database/index.js";
import type {
  DataActorContext,
  DataListOptions,
  DataReader,
  DataResource,
  DataResourceInput,
  DataRow,
  DataScope,
  DataScopeReader,
} from "./model.js";
import {
  actorLabel,
  addFilters,
  addOwnedValue,
  addScopePredicate,
  assertColumnScopes,
  assertWritable,
  cleanWritableValues,
  isAllowed,
  quote,
} from "./policy.js";
import { normalizeDataResources } from "./resources.js";

interface DataReaderOptions {
  resources?: readonly DataResourceInput[];
  context?: DataActorContext | (() => DataActorContext | Promise<DataActorContext>);
}

interface CountRow { count: number | string }

export function createDataReader(
  env: D1Environment,
  { resources = [], context }: DataReaderOptions = {},
): DataReader {
  const registry = new Map(
    normalizeDataResources(resources).map((resource) => [resource.name, resource]),
  );
  const getContext = typeof context === "function"
    ? async () => context()
    : async () => context || {};

  function scope(requestedScope: DataScope): DataScopeReader {
    return {
      context: getContext,
      list: (name, options) => readList(name, requestedScope, options),
      page: (name, options) => readPage(name, requestedScope, options),
      count: (name, options) => readCount(name, requestedScope, options),
      get: async (name, id) => {
        const resource = getResource(name);
        return (await readList(name, requestedScope, {
          where: { [resource.idColumn]: id },
          limit: 1,
        }))[0] || null;
      },
      insert: (name, values) => writeInsert(name, requestedScope, values),
      update: (name, id, changes) => writeUpdate(name, requestedScope, id, changes),
      updateWhere: (name, where, changes) => writeUpdateWhere(name, requestedScope, where, changes),
      delete: (name, id) => writeDelete(name, requestedScope, id),
      deleteWhere: (name, where) => writeDeleteWhere(name, requestedScope, where),
    };
  }

  async function readList(
    name: string,
    requestedScope: DataScope,
    options: DataListOptions = {},
  ): Promise<DataRow[]> {
    return (await readPage(name, requestedScope, options)).rows;
  }

  async function readPage(
    name: string,
    requestedScope: DataScope,
    { where = {}, limit = 100, orderBy, cursor, offset = 0 }: DataListOptions = {},
  ) {
    const resource = getResource(name);
    const actor = await getContext();
    if (!isAllowed(resource, requestedScope, actor, "read")) {
      return { rows: [], nextCursor: null };
    }

    const predicates: string[] = [];
    const bindings: unknown[] = [];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    addFilters(resource, where, predicates, bindings);
    const [orderColumn, rawDirection = "ASC"] = orderBy
      ? String(orderBy).split(/\s+/, 2)
      : [resource.idColumn, "ASC"];
    if (orderBy && !resource.orderableColumns.includes(orderColumn)) {
      throw new TypeError(`Column ${orderColumn} cannot order ${resource.name}`);
    }
    const direction = rawDirection.toUpperCase() === "DESC" ? "DESC" : "ASC";
    if (cursor !== undefined && cursor !== null) {
      if (orderColumn !== resource.idColumn) {
        throw new TypeError(`Cursor pagination for ${resource.name} requires ${resource.idColumn} ordering`);
      }
      predicates.push(`${quote(resource.idColumn)}${direction === "DESC" ? "<" : ">"}?`);
      bindings.push(cursor);
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    let sql = `SELECT ${resource.readableColumns.map(quote).join(",")} FROM ${quote(resource.table)}`
      + `${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""}`
      + ` ORDER BY ${quote(orderColumn)} ${direction} LIMIT ${safeLimit} OFFSET ${safeOffset}`;

    const result = await createD1(env, { who: actorLabel(actor) })
      .prepare(sql)
      .bind(...bindings)
      .all<DataRow>();
    const rows = result.results || [];
    return {
      rows,
      nextCursor: orderColumn === resource.idColumn && rows.length === safeLimit
        ? rows.at(-1)?.[resource.idColumn] ?? null
        : null,
    };
  }

  async function readCount(
    name: string,
    requestedScope: DataScope,
    { where = {} }: Pick<DataListOptions, "where"> = {},
  ): Promise<number> {
    const resource = getResource(name);
    const actor = await getContext();
    if (!isAllowed(resource, requestedScope, actor, "read")) return 0;

    const predicates: string[] = [];
    const bindings: unknown[] = [];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    addFilters(resource, where, predicates, bindings);
    const sql = `SELECT COUNT(*) AS count FROM ${quote(resource.table)}`
      + `${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""}`;
    const result = await createD1(env, { who: actorLabel(actor) })
      .prepare(sql)
      .bind(...bindings)
      .first<CountRow>();
    return Number(result?.count || 0);
  }

  async function writeInsert(
    name: string,
    requestedScope: DataScope,
    values: DataRow = {},
  ): Promise<DataRow> {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "create");
    const data = cleanWritableValues(resource, values, {
      includeId: true,
      includeOwnership: requestedScope === "system",
    });
    assertColumnScopes(resource, actor, Object.keys(data));
    addOwnedValue(resource, requestedScope, actor, data);
    const columns = Object.keys(data);
    if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`);

    const sql = `INSERT INTO ${quote(resource.table)} (${columns.map(quote).join(",")})`
      + ` VALUES (${columns.map(() => "?").join(",")})`;
    const result = await createD1(env, { who: actorLabel(actor) })
      .prepare(sql)
      .bind(...columns.map((column) => data[column]))
      .run();
    const insertedId = data[resource.idColumn] === undefined
      ? result.meta?.last_row_id
      : data[resource.idColumn];
    if (insertedId === undefined) return data;
    return (await readList(name, requestedScope, {
      where: { [resource.idColumn]: insertedId },
      limit: 1,
    }))[0] || { ...data, [resource.idColumn]: insertedId };
  }

  async function writeUpdate(
    name: string,
    requestedScope: DataScope,
    id: unknown,
    changes: DataRow = {},
  ): Promise<DataRow | null> {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "update");
    const data = cleanWritableValues(resource, changes, {
      includeOwnership: requestedScope === "system",
    });
    assertColumnScopes(resource, actor, Object.keys(data));
    const columns = Object.keys(data);
    if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`);

    const predicates = [`${quote(resource.idColumn)}=?`];
    const bindings: unknown[] = [id];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    await createD1(env, { who: actorLabel(actor) })
      .prepare(`UPDATE ${quote(resource.table)} SET ${columns.map((column) => `${quote(column)}=?`).join(",")} WHERE ${predicates.join(" AND ")}`)
      .bind(...columns.map((column) => data[column]), ...bindings)
      .run();
    return (await readList(name, requestedScope, {
      where: { [resource.idColumn]: id },
      limit: 1,
    }))[0] || null;
  }

  async function writeDelete(
    name: string,
    requestedScope: DataScope,
    id: unknown,
  ): Promise<D1Result<unknown>> {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "delete");
    const predicates = [`${quote(resource.idColumn)}=?`];
    const bindings: unknown[] = [id];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    return createD1(env, { who: actorLabel(actor) })
      .prepare(`DELETE FROM ${quote(resource.table)} WHERE ${predicates.join(" AND ")}`)
      .bind(...bindings)
      .run();
  }

  async function writeUpdateWhere(
    name: string,
    requestedScope: DataScope,
    where: DataRow,
    changes: DataRow,
  ): Promise<number> {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "update");
    const data = cleanWritableValues(resource, changes, {
      includeOwnership: requestedScope === "system",
    });
    assertColumnScopes(resource, actor, Object.keys(data));
    const columns = Object.keys(data);
    if (!columns.length) throw new TypeError(`No writable values supplied for ${resource.name}`);

    const predicates: string[] = [];
    const bindings: unknown[] = [];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    addFilters(resource, where, predicates, bindings);
    const result = await createD1(env, { who: actorLabel(actor) })
      .prepare(`UPDATE ${quote(resource.table)} SET ${columns.map((column) => `${quote(column)}=?`).join(",")} WHERE ${predicates.join(" AND ")}`)
      .bind(...columns.map((column) => data[column]), ...bindings)
      .run();
    return Number(result.meta?.changes || 0);
  }

  async function writeDeleteWhere(
    name: string,
    requestedScope: DataScope,
    where: DataRow,
  ): Promise<D1Result<unknown>> {
    const resource = getResource(name);
    const actor = await getContext();
    assertWritable(resource, requestedScope, actor, "delete");
    const predicates: string[] = [];
    const bindings: unknown[] = [];
    addScopePredicate(resource, requestedScope, actor, predicates, bindings);
    addFilters(resource, where, predicates, bindings);
    return createD1(env, { who: actorLabel(actor) })
      .prepare(`DELETE FROM ${quote(resource.table)} WHERE ${predicates.join(" AND ")}`)
      .bind(...bindings)
      .run();
  }

  function getResource(name: string): DataResource {
    const resource = registry.get(String(name));
    if (!resource) throw new TypeError(`Unknown data resource: ${name}`);
    return resource;
  }

  return {
    user: scope("user"),
    tenant: scope("tenant"),
    public: scope("public"),
    system: scope("system"),
    context: getContext,
    resources: [...registry.values()],
  };
}
