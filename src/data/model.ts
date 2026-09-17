export const DATA_SCOPES = ["user", "tenant", "public", "system"] as const;
export const DATA_OPERATIONS = ["read", "create", "update", "delete"] as const;

export type DataScope = (typeof DATA_SCOPES)[number];
export type DataOperation = (typeof DATA_OPERATIONS)[number];
export type DataRow = Record<string, unknown>;

export interface DataTenant {
  id: string;
  name?: string;
}

export interface PublicReadPredicate {
  column: string;
  value: unknown;
}

export interface DataResourceInput {
  name?: string;
  table?: string;
  scope?: string;
  columns?: readonly unknown[];
  readableColumns?: readonly unknown[];
  filterableColumns?: readonly unknown[];
  orderableColumns?: readonly unknown[];
  writableColumns?: readonly unknown[];
  idColumn?: string;
  ownerColumn?: string;
  tenantColumn?: string;
  columnScopes?: Record<string, string | readonly string[]>;
  operationScopes?: Partial<Record<DataOperation, string | readonly string[]>>;
  operations?: readonly unknown[];
  publicRead?: boolean | { column?: string; value?: unknown };
  [key: string]: unknown;
}

export interface DataResource extends Omit<DataResourceInput,
  "name" | "table" | "scope" | "columns" | "readableColumns" | "filterableColumns"
  | "orderableColumns" | "writableColumns" | "idColumn" | "ownerColumn" | "tenantColumn"
  | "columnScopes" | "operationScopes" | "operations" | "publicRead"
> {
  name: string;
  table: string;
  scope: DataScope;
  columns: string[];
  readableColumns: string[];
  filterableColumns: string[];
  orderableColumns: string[];
  writableColumns: string[];
  idColumn: string;
  ownerColumn: string;
  tenantColumn: string;
  columnScopes: Record<string, string[]>;
  operationScopes: Partial<Record<DataOperation, string[]>>;
  operations: DataOperation[];
  publicRead: boolean | PublicReadPredicate;
}

export interface DataActorContext {
  userId?: string | null;
  displayName?: string | null;
  tenantId?: string | null;
  publicTenantId?: string | null;
  public?: boolean;
  system?: boolean;
  scopes?: string[];
  tenants?: DataTenant[];
  invalidTenant?: boolean;
  impersonated?: boolean;
  impersonatedBy?: string | null;
}

export interface DataListOptions {
  where?: DataRow;
  limit?: number;
  orderBy?: string;
  cursor?: unknown;
  offset?: number;
}

export interface DataPage<Row extends DataRow = DataRow> {
  rows: Row[];
  nextCursor: unknown | null;
}

export interface DataScopeReader<Row extends DataRow = DataRow> {
  context(): Promise<DataActorContext>;
  list(name: string, options?: DataListOptions): Promise<Row[]>;
  page(name: string, options?: DataListOptions): Promise<DataPage<Row>>;
  count(name: string, options?: Pick<DataListOptions, "where">): Promise<number>;
  get(name: string, id: unknown): Promise<Row | null>;
  insert(name: string, values?: DataRow): Promise<Row | DataRow>;
  update(name: string, id: unknown, changes?: DataRow): Promise<Row | null>;
  updateWhere(name: string, where: DataRow, changes: DataRow): Promise<number>;
  delete(name: string, id: unknown): Promise<D1Result<unknown>>;
  deleteWhere(name: string, where: DataRow): Promise<D1Result<unknown>>;
}

export interface DataReader {
  user: DataScopeReader;
  tenant: DataScopeReader;
  public: DataScopeReader;
  system: DataScopeReader;
  context(): Promise<DataActorContext>;
  resources: DataResource[];
}
