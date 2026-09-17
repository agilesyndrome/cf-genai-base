export type CliTarget = "local" | "staging" | "production";

export interface CliOptions {
  config: string;
  database: string;
  productionDatabase: string;
  productionEnv: string;
  stagingEnv: string;
  wranglerCommand: string[];
  yes: boolean;
  confirmProduction: boolean;
  target: string;
  roles?: string;
  scopes?: string;
  groups?: string;
  tenants?: string;
  name?: string;
  output?: string;
  file?: string;
  json: boolean;
  help: boolean;
  positional: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CliJsonRow {
  [column: string]: unknown;
}

export interface D1CommandInput {
  target: CliTarget;
  database: string;
  options: CliOptions;
}

export interface D1RefreshInput extends D1CommandInput {
  productionDatabase: string;
}

export interface OperationalCommandInput {
  domain: string;
  action?: string;
  identifier?: string;
  value?: string;
  options: CliOptions;
}
