import { defineApp, type AppDefinitionInput } from "../app.js";
import { createWorker } from "./worker.js";
import type { CreateWorkerOptions, RuntimeBindings, RuntimeState } from "./model.js";

export type CreateAppOptions<Env extends RuntimeBindings = RuntimeBindings, State extends RuntimeState = RuntimeState> =
  AppDefinitionInput & { fetch?: CreateWorkerOptions<Env, State>["fetch"] };

/** Create a Worker from the high-level app manifest with a safe empty fallback handler. */
export function createApp<Env extends RuntimeBindings = RuntimeBindings, State extends RuntimeState = RuntimeState>(
  input: CreateAppOptions<Env, State> = {},
) {
  const { fetch = async () => new Response("Not Found", { status: 404 }), ...manifest } = input;
  return createWorker({ app: defineApp(manifest), fetch });
}
