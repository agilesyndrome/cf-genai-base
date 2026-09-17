import type { AdminBindings, AdminIdentity, AdminRequestState } from "../admin/types.js";
import type { AnyAppDomain, AppDefinition, AppDefinitionInput } from "../app.js";
import type { AppEvent, EventHandler } from "../core/events/index.js";
import type { DataActorContext, DataReader, DataResourceInput } from "../data/model.js";
import type { Repository, RepositoryDefinitionInput } from "../repository/model.js";
import type { CircuitBreakerInput } from "../core/circuits/model.js";
import type { HealthcheckInput } from "../core/healthchecks/model.js";
import type { WorkerLayer } from "./hono.js";

export interface RuntimeFeature<Env extends RuntimeBindings = RuntimeBindings, State extends RuntimeState = RuntimeState> {
  name: string;
  id?: string;
  displayName?: string;
  packageName?: string;
  version?: string;
  domains?: readonly AnyAppDomain[];
  healthcheck?: (
    env: Env,
    options?: FeatureManifestOptions,
  ) => HealthcheckInput | readonly HealthcheckInput[] | Promise<HealthcheckInput | readonly HealthcheckInput[]>;
  healthchecks?: readonly HealthcheckInput[];
  circuitBreakers?: readonly CircuitBreakerInput[];
  middleware?: WorkerLayer<RuntimeRequestEnvironment<Env>, State>;
  getUser?: (request: Request, env: Env) => AdminIdentity | null | Promise<AdminIdentity | null>;
  eventHandler?: EventHandler<Env, ExecutionContext>;
  event_handler?: EventHandler<Env, ExecutionContext>;
  [key: string]: unknown;
}

/** Shared options implemented by first-party and external App SDK features. */
export interface RuntimeFeatureOptions<
  Env extends RuntimeBindings = RuntimeBindings,
  State extends RuntimeState = RuntimeState,
> {
  name?: string;
  displayName?: string;
  domains?: readonly AnyAppDomain[];
  healthcheck?: RuntimeFeature<Env, State>["healthcheck"];
  healthchecks?: readonly HealthcheckInput[];
  circuitBreakers?: readonly CircuitBreakerInput[];
  boot?: (
    env: RuntimeRequestEnvironment<Env>,
    context: { request: Request; ctx: RuntimeExecutionContext; state: State },
  ) => void | Promise<void>;
  middleware?: WorkerLayer<RuntimeRequestEnvironment<Env>, State>;
}

type RuntimeExecutionContext = Parameters<WorkerLayer>[2];

export interface RuntimeBindings extends AdminBindings {
  BUILD_SHA?: string;
  BUILD_NUMBER?: string | number;
  EVENT_HUB?: DurableObjectNamespace;
  [key: string]: unknown;
}

export interface RuntimeState extends AdminRequestState {
  requestId: string;
  user?: AdminIdentity | null;
  data?: DataReader;
  context?: RuntimeRequestContext;
  tenantId?: string;
}

export type RuntimeEventEmitter = (
  what: string,
  where?: string,
  details?: Record<string, unknown>,
  when?: Date,
) => Promise<AppEvent | null>;

export interface RuntimeRequestContext {
  request: Request;
  env: RuntimeRequestEnvironment;
  ctx: ExecutionContext;
  state: RuntimeState;
  data?: DataReader;
  userId: string | null;
  who: string;
  isAuthenticated: boolean;
  isAdmin: boolean;
  event: RuntimeEventEmitter;
}

export type RuntimeRequestEnvironment<Env extends RuntimeBindings = RuntimeBindings> = Env & {
  app?: Readonly<AppDefinition>;
  features?: RuntimeFeature[];
  data?: DataReader;
  repositories?: Record<string, Repository>;
  user?: AdminIdentity | null;
  authUser?: AdminIdentity["authUser"];
  userId?: string | null;
  requestId?: string;
  context?: RuntimeRequestContext;
  eventHubBinding?: string;
  eventHandler?: (event: AppEvent, env: RuntimeRequestEnvironment, ctx: ExecutionContext) => Promise<AppEvent | null>;
  event?: RuntimeEventEmitter;
};

export type RuntimeMiddleware<Env extends RuntimeBindings, State extends RuntimeState> =
  WorkerLayer<RuntimeRequestEnvironment<Env>, State>;

export interface CreateWorkerOptions<Env extends RuntimeBindings = RuntimeBindings, State extends RuntimeState = RuntimeState> {
  fetch: (
    request: Request,
    env: RuntimeRequestEnvironment<Env>,
    ctx: ExecutionContext,
    state: State,
  ) => Response | Promise<Response>;
  scheduled?: (controller: ScheduledController, env: Env, ctx: ExecutionContext) => void | Promise<void>;
  app?: AppDefinitionInput;
  authorize?: (context: {
    request: Request;
    url: URL;
    user: AdminIdentity;
    env: RuntimeRequestEnvironment<Env>;
    ctx: ExecutionContext;
    state: State;
  }) => boolean | Promise<boolean>;
  middleware?: readonly RuntimeMiddleware<Env, State>[];
  publicTenantId?: string | null;
  health?: HealthProvider;
  boot?: (env: Env, context: { request: Request; ctx: ExecutionContext }) => unknown;
  security?: boolean;
  eventHubBinding?: string;
}

export type HealthDetails = Record<string, unknown>;
export type HealthProvider = (
  env: RuntimeBindings,
  context: { request: Request; ctx: ExecutionContext; state: RuntimeState },
) => HealthDetails | Promise<HealthDetails>;

export interface FeatureManifestOptions { who?: string }

export interface BootSpec {
  bindings?: readonly string[];
  required?: readonly string[];
}

export interface BootValidation {
  ok: boolean;
  missingBindings: string[];
  missingValues: string[];
}

export type DomainResourceDefinition = DataResourceInput;
export type DomainRepositoryDefinition = RepositoryDefinitionInput;
export type ResolvedDataContext = DataActorContext;
