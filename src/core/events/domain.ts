import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import { secureJson } from "../security/index.js";

export interface LiveEventsEnvironment { eventHubBinding?: string; EVENT_HUB?: DurableObjectNamespace }
export interface LiveEventsState {
  authUser?: { id?: string } | null;
  user?: { sub?: string; auth_strategy?: string } | null;
}
type Context = DomainRequestContext<LiveEventsEnvironment, LiveEventsState>;
interface LiveEventHubNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

export class LiveEventsDomain extends AppDomain<unknown, LiveEventsEnvironment, LiveEventsState> {
  constructor() {
    super({ name: "core.live-events", basePath: "/api/events", auth: "user" });
    this.route({ method: "GET", handler: connect });
  }
}

async function connect({ request, env, state }: Context) {
  const ownerId = state.authUser?.id
    || state.user?.sub
    || (state.user?.auth_strategy === "http_basic" ? "basic:admin" : null);
  const namespace = eventHubNamespace(env, env.eventHubBinding || "EVENT_HUB");
  if (!namespace) {
    return secureJson({ error: "Live events are not configured." }, 501);
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return secureJson({ error: "WebSocket upgrade required." }, 426, { Upgrade: "websocket" });
  }
  const stub = namespace.get(namespace.idFromName(`user:${ownerId}`));
  return stub.fetch("https://cf-genai-event-hub/connect", {
    headers: { Upgrade: "websocket" },
  });
}

export const coreLiveEvents = new LiveEventsDomain();

function eventHubNamespace(env: LiveEventsEnvironment, bindingName: string): LiveEventHubNamespace | null {
  const candidate: unknown = Reflect.get(env, bindingName);
  if (candidate === null || typeof candidate !== "object") return null;
  const idFromName: unknown = Reflect.get(candidate, "idFromName");
  const get: unknown = Reflect.get(candidate, "get");
  if (typeof idFromName !== "function" || typeof get !== "function") return null;
  return {
    idFromName: (name) => Reflect.apply(idFromName, candidate, [name]),
    get: (id) => Reflect.apply(get, candidate, [id]),
  };
}
