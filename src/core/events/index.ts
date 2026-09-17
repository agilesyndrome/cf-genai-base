export type EventJsonPrimitive = string | number | boolean | null;

export interface EventDetails {
  readonly [key: string]: EventJsonValue;
}

export type EventJsonValue = EventJsonPrimitive | EventDetails | readonly EventJsonValue[];

export interface AppEvent<Details extends EventDetails = EventDetails> {
  id: string;
  who: string;
  what: string;
  where: string;
  when: string;
  details: Details;
}

export interface EventAudience {
  userId?: string;
  tenantId?: string;
}

export type EventRoom = `user:${string}` | `tenant:${string}`;
export type EventLogLevel = "debug" | "info" | "warn" | "error";

export interface EventHandlerContext<Env = unknown, Context = unknown> {
  env: Env;
  ctx: Context;
}

export type EventHandler<Env = unknown, Context = unknown> = (
  event: AppEvent,
  context: EventHandlerContext<Env, Context>,
) => unknown | Promise<unknown>;

export interface EventFeature<Env = unknown, Context = unknown> {
  eventHandler?: EventHandler<Env, Context>;
  event_handler?: EventHandler<Env, Context>;
}

export interface EventHandlerOptions {
  eventHubBinding?: string;
}

export interface EventEnvironment<Env = unknown, Context = unknown> {
  eventHandler?: (event: AppEvent, env: Env, ctx: Context) => AppEvent | null | Promise<AppEvent | null>;
}

export interface AuditLogInput {
  who?: string;
  operation: string;
  resource: string;
  details?: unknown;
}

interface EventHubNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
}

export function Event(
  who: unknown,
  what: unknown,
  where: unknown,
  when: Date | string | number | null | undefined = new Date(),
  details: unknown = {},
): AppEvent {
  return {
    id: crypto.randomUUID(),
    who: String(who || "system"),
    what: String(what || "event"),
    where: String(where || "application"),
    when: when instanceof Date ? when.toISOString() : new Date(when || Date.now()).toISOString(),
    details: toEventDetails(details),
  };
}

export function createEventHandler<Env = unknown, Context = unknown>(
  features: readonly EventFeature<Env, Context>[] = [],
  { eventHubBinding = "EVENT_HUB" }: EventHandlerOptions = {},
): (event: AppEvent | null | undefined, env: Env, ctx: Context) => Promise<AppEvent | null> {
  const handlers = features.flatMap((feature) => {
    const handler = feature.eventHandler || feature.event_handler;
    return typeof handler === "function" ? [handler.bind(feature)] : [];
  });
  return async (event, env, ctx) => {
    if (!event) return null;
    eventLog("info", event.what, { who: event.who, where: event.where, when: event.when, ...event.details });
    await Promise.all([
      ...handlers.map((handler) => Promise.resolve(handler(event, { env, ctx }))),
      publishLiveEvent(env, event, eventHubBinding),
    ]);
    return event;
  };
}

export function eventRooms(event: Pick<AppEvent, "who" | "details"> | null | undefined): EventRoom[] {
  const audience = event?.details.audience;
  const rooms: EventRoom[] = [];
  if (isEventDetails(audience)) {
    if (typeof audience.userId === "string" && audience.userId) rooms.push(`user:${audience.userId}`);
    if (typeof audience.tenantId === "string" && audience.tenantId) rooms.push(`tenant:${audience.tenantId}`);
  }
  if (!rooms.length && event?.who.startsWith("user:")) rooms.push(`user:${event.who.slice(5)}`);
  return [...new Set(rooms)];
}

async function publishLiveEvent(env: unknown, event: AppEvent, bindingName: string): Promise<void> {
  const namespace = readEventHubNamespace(env, bindingName);
  if (!namespace) return;
  for (const room of eventRooms(event)) {
    try {
      const stub = namespace.get(namespace.idFromName(room));
      await stub.fetch("https://cf-genai-event-hub/publish", {
        method: "POST",
        headers: { "X-CF-GenAI-Event": "1", "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
    } catch (error: unknown) {
      eventLog("warn", "live.event.publish.failed", { room, error: safeErrorMessage(error) });
    }
  }
}

export async function emitEvent<Env = unknown, Context = unknown>(
  env: Env,
  event: AppEvent | null | undefined,
  ctx: Context,
): Promise<AppEvent | null> {
  const handler = readEventHandler(env);
  if (handler && event) return handler(event, env, ctx);
  if (event) eventLog("info", event.what, { who: event.who, where: event.where, when: event.when, ...event.details });
  return event ?? null;
}

export function eventLog(level: string, event: string, details: unknown = {}): void {
  const method: EventLogLevel = isEventLogLevel(level) ? level : "info";
  console[method](`[EventLog] ${event}`, redactLogDetails(details));
}

export function auditLog({ who = "system", operation, resource, details = {} }: AuditLogInput): void {
  console.info(`[AuditLog] ${who}:${operation} ${resource}`, redactLogDetails(details));
}

function isEventLogLevel(value: string): value is EventLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function isEventDetails(value: unknown): value is EventDetails {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toEventJsonValue(value: unknown, seen: WeakSet<object>): EventJsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => toEventJsonValue(item, seen) ?? null);
  if (typeof value === "bigint") return String(value);
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const result: Record<string, EventJsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = toEventJsonValue(child, seen);
    if (normalized !== undefined) result[key] = normalized;
  }
  seen.delete(value);
  return result;
}

function toEventDetails(value: unknown): EventDetails {
  if (!isEventDetails(value)) return { value: toEventJsonValue(value, new WeakSet()) ?? null };
  const result: Record<string, EventJsonValue> = {};
  const seen = new WeakSet<object>([value]);
  for (const [key, child] of Object.entries(value)) {
    const normalized = toEventJsonValue(child, seen);
    if (normalized !== undefined) result[key] = normalized;
  }
  return result;
}

function redactLogDetails(value: unknown): EventJsonValue {
  const sensitive = /^(?:authorization|cookie|set-cookie|password|secret|token|requestBody|body)$/i;
  const redact = (child: unknown, seen: WeakSet<object>): EventJsonValue => {
    if (child === null || typeof child === "string" || typeof child === "boolean") return child;
    if (typeof child === "number") return Number.isFinite(child) ? child : null;
    if (Array.isArray(child)) return child.map((item) => redact(item, seen));
    if (typeof child !== "object") return String(child);
    if (seen.has(child)) return "[Circular]";
    seen.add(child);
    const result: Record<string, EventJsonValue> = {};
    for (const [key, item] of Object.entries(child)) result[key] = sensitive.test(key) ? "[REDACTED]" : redact(item, seen);
    seen.delete(child);
    return result;
  };
  return redact(value, new WeakSet());
}

function readEventHubNamespace(env: unknown, bindingName: string): EventHubNamespace | null {
  if (!bindingName || env === null || typeof env !== "object") return null;
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

function readEventHandler(env: unknown): ((event: AppEvent, handlerEnv: unknown, ctx: unknown) => Promise<AppEvent | null>) | null {
  if (env === null || typeof env !== "object") return null;
  const handler: unknown = Reflect.get(env, "eventHandler");
  if (typeof handler !== "function") return null;
  return async (event, handlerEnv, ctx) => Promise.resolve(Reflect.apply(handler, env, [event, handlerEnv, ctx]));
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

export { LiveEventsDomain, coreLiveEvents, type LiveEventsEnvironment, type LiveEventsState } from "./domain.js";
