export function Event(who, what, where, when = new Date(), details = {}) {
  return {
    id: crypto.randomUUID(),
    who: String(who || "system"),
    what: String(what || "event"),
    where: String(where || "application"),
    when: when instanceof Date ? when.toISOString() : new Date(when || Date.now()).toISOString(),
    details: details && typeof details === "object" ? details : { value: details },
  };
}

export function createEventHandler(features = [], { eventHubBinding = "EVENT_HUB" } = {}) {
  const handlers = features.flatMap((feature) => {
    const handler = feature?.eventHandler || feature?.event_handler;
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

export function eventRooms(event) {
  const audience = event?.details?.audience || {};
  const rooms = [];
  if (audience.userId) rooms.push(`user:${audience.userId}`);
  if (audience.tenantId) rooms.push(`tenant:${audience.tenantId}`);
  if (!rooms.length && String(event?.who || "").startsWith("user:")) rooms.push(String(event.who));
  return [...new Set(rooms)];
}

async function publishLiveEvent(env, event, bindingName) {
  const namespace = bindingName && env?.[bindingName];
  if (!namespace || typeof namespace.idFromName !== "function") return;
  for (const room of eventRooms(event)) {
    try {
      const stub = namespace.get(namespace.idFromName(room));
      await stub.fetch("https://cf-genai-event-hub/publish", { method: "POST", headers: { "X-CF-GenAI-Event": "1", "Content-Type": "application/json" }, body: JSON.stringify(event) });
    } catch (error) {
      eventLog("warn", "live.event.publish.failed", { room, error: error?.message || String(error) });
    }
  }
}

export async function emitEvent(env, event, ctx) {
  if (typeof env?.eventHandler === "function") return env.eventHandler(event, env, ctx);
  if (event) eventLog("info", event.what, { who: event.who, where: event.where, when: event.when, ...event.details });
  return event;
}

export function eventLog(level, event, details = {}) {
  const method = ["debug", "info", "warn", "error"].includes(level) ? level : "info";
  console[method](`[EventLog] ${event}`, details);
}

export function auditLog({ who = "system", operation, resource, details = {} }) {
  console.info(`[AuditLog] ${who}:${operation} ${resource}`, details);
}
