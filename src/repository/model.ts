import type { DataPage, DataResourceInput, DataRow, DataScope, DataScopeReader } from "../data/model.js";

export interface RepositoryRelation {
  repository: string;
  localKey?: string;
  foreignKey?: string;
  many?: boolean;
  where?: DataRow;
  options?: Record<string, unknown>;
}

export interface RepositoryHookContext {
  env: RepositoryEnvironment;
  context: unknown;
  repository: Repository;
}

export type RepositoryHook<Input = unknown, Output = Input> = (
  value: Input,
  context: RepositoryHookContext,
) => Output | Promise<Output>;

export interface RepositoryHooks {
  list?: RepositoryHook<DataRow[]>;
  page?: RepositoryHook<DataPage>;
  find?: RepositoryHook<DataRow | null>;
  findOne?: RepositoryHook<DataRow | null>;
  beforeInsert?: RepositoryHook<DataRow>;
  afterInsert?: RepositoryHook<DataRow>;
  beforeUpdate?: RepositoryHook<DataRow>;
  afterUpdate?: RepositoryHook<DataRow | null>;
}

export interface RepositoryDefinitionInput {
  name?: string;
  resource?: string;
  scope?: DataScope;
  relations?: Record<string, RepositoryRelation>;
  hooks?: RepositoryHooks;
  resourceDefinition?: DataResourceInput | null;
}

export interface RepositoryDefinition {
  name: string;
  resource: string;
  scope: DataScope;
  relations: Record<string, RepositoryRelation>;
  hooks: RepositoryHooks;
  resourceDefinition: DataResourceInput | null;
}

export interface RepositoryEnvironment {
  data?: Partial<Record<DataScope, DataScopeReader>>;
  [key: string]: unknown;
}

export interface Repository {
  name: string;
  resource: string;
  list(options?: Record<string, unknown>): Promise<DataRow[]>;
  page(options?: Record<string, unknown>): Promise<DataPage>;
  count(options?: Record<string, unknown>): Promise<number>;
  find(id: unknown): Promise<DataRow | null>;
  findOne(where: DataRow, options?: Record<string, unknown>): Promise<DataRow | null>;
  insert(values: DataRow): Promise<DataRow>;
  update(id: unknown, changes: DataRow): Promise<DataRow | null>;
  updateWhere(where: DataRow, changes: DataRow): Promise<number>;
  delete(id: unknown): Promise<D1Result<unknown>>;
  deleteWhere(where: DataRow): Promise<D1Result<unknown>>;
  link(relation: string, record: DataRow): Promise<unknown>;
}
