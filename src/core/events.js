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

export function createEventHandler(features = []) {
  const handlers = features.flatMap((feature) => {
    const handler = feature?.eventHandler || feature?.event_handler;
    return typeof handler === "function" ? [handler.bind(feature)] : [];
  });
  return async (event, env, ctx) => {
    if (!event) return null;
    eventLog("info", event.what, { who: event.who, where: event.where, when: event.when, ...event.details });
    await Promise.all(handlers.map((handler) => Promise.resolve(handler(event, { env, ctx }))));
    return event;
  };
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
