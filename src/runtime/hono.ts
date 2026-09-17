import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

export type RuntimeExecutionContext = ExecutionContext;

/**
 * The public worker middleware contract predates Hono. This adapter lets existing
 * features keep that contract while Hono owns ordering, dispatch, and fallthrough.
 * New runtime middleware should prefer Hono's `(c, next)` shape directly.
 */
export type WorkerLayer<Env extends object = Record<string, unknown>, State = object> = (
  request: Request,
  env: Env,
  ctx: RuntimeExecutionContext,
  next: (request?: Request) => Promise<Response>,
  state: State,
) => Response | Promise<Response>;

export interface HonoRuntimeOptions<Env extends object, State> {
  layers?: readonly WorkerLayer<Env, State>[];
  terminal: (
    request: Request,
    env: Env,
    ctx: RuntimeExecutionContext,
    state: State,
  ) => Response | Promise<Response>;
}

const STATE_KEY = "__cfgenai_runtime_state";
const CONTEXT_KEY = "__cfgenai_execution_context";

type RuntimeBindings<Env extends object, State> = Env & {
  [STATE_KEY]?: State;
  [CONTEXT_KEY]?: ExecutionContext;
};

/**
 * Build one Hono application per Worker instance. State is attached to a short-lived
 * environment facade for each request, never to the Hono app or module globals.
 */
export function createHonoRuntime<Env extends object, State>(
  options: HonoRuntimeOptions<Env, State>,
) {
  const app = new Hono<{ Bindings: RuntimeBindings<Env, State> }>();

  for (const layer of options.layers ?? []) {
    const middleware: MiddlewareHandler<{ Bindings: RuntimeBindings<Env, State> }> = async (
      c,
      next,
    ) => {
      const state = c.env[STATE_KEY];
      const executionContext = c.env[CONTEXT_KEY];
      if (!state || !executionContext) return c.text("Runtime request state is missing.", 500);

      let downstreamCalled = false;
      const nextRequest = async (_request: Request = c.req.raw): Promise<Response> => {
        downstreamCalled = true;
        await next();
        return c.res;
      };
      const response = await layer(
        c.req.raw,
        c.env,
        executionContext,
        nextRequest,
        state,
      );

      // Hono stores the downstream response on c.res. Returning it here preserves the
      // old middleware contract while allowing Hono to continue its normal unwind.
      return response instanceof Response ? response : downstreamCalled ? c.res : c.res;
    };
    app.use("*", middleware);
  }

  app.all("*", (c) => {
    const state = c.env[STATE_KEY];
    const executionContext = c.env[CONTEXT_KEY];
    if (!state || !executionContext) return c.text("Runtime request state is missing.", 500);
    return options.terminal(c.req.raw, c.env, executionContext, state);
  });

  return {
    app,
    fetch(request: Request, env: Env, ctx: ExecutionContext, state: State) {
      const requestEnv: RuntimeBindings<Env, State> = {
        ...env,
        [STATE_KEY]: state,
        [CONTEXT_KEY]: ctx,
      };
      return app.fetch(request, requestEnv, ctx);
    },
  };
}
