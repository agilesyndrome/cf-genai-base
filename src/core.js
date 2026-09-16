export const HEALTHCHECK_STATES = ["red", "yellow", "green"];
export const CIRCUIT_BREAKER_STATES = ["off", "tripped", "on"];
export const HEALTHCHECK_MODES = ["any", "all"];
export const BASE_PACKAGE_NAME = "@agilesyndrome/cf-genai-base";
export const BASE_VERSION = "4.1.3";

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

export function requestActor(state = {}) {
  if (state.requestedBy) return String(state.requestedBy);
  const canonical = authUser(state);
  if (canonical?.id) return `user:${canonical.id}`;
  if (state.user?.auth_strategy === "http_basic") return "user:admin";
  if (state.user?.sub) return `user:${state.user.sub}`;
  return "system:read";
}

export function authUser(value) {
  return value?.authUser || value?.user?.authUser || value?.state?.authUser || value?.state?.user?.authUser || (value?.id && value?.provider && value?.subject ? value : null) || null;
}

export function userId(value) {
  return authUser(value)?.id || value?.userId || value?.sub || value?.email || null;
}

export function requestIdentity(state = {}) {
  const canonical = authUser(state);
  return {
    user: state.user || null,
    authUser: canonical,
    userId: canonical?.id || null,
    who: requestActor(state),
    isAuthenticated: Boolean(canonical || state.user),
    isAdmin: Boolean(state.user?.auth_strategy === "http_basic" || canonical?.is_admin),
  };
}

export function requestContext({ request, env, ctx, state, data } = {}) {
  const identity = requestIdentity(state);
  return {
    request, env, ctx, state, data: data || state?.data,
    ...identity,
    event: (what, where = "application", details = {}, when = new Date()) => emitEvent(env, Event(identity.who, what, where, when, details), ctx),
  };
}

export function sameOrigin(request, allowedOrigins = []) {
  const origin = request?.headers?.get("Origin");
  if (!origin) return false;
  const requestOrigin = (() => { try { return new URL(request.url).origin; } catch { return ""; } })();
  const allowed = new Set((Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins]).filter(Boolean).map(String));
  if (!allowed.size && requestOrigin) allowed.add(requestOrigin);
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  return allowed.has(origin) && (!fetchSite || fetchSite === "same-origin");
}

export async function readJsonClone(request, maxBytes = 64 * 1024) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return { error: secureJson({ error: "JSON request required" }, 415) };
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { error: secureJson({ error: "Request body is too large" }, 413) };
  try {
    const value = await request.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Object required");
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) return { error: secureJson({ error: "Request body is too large" }, 413) };
    return { value };
  } catch {
    return { error: secureJson({ error: "Invalid JSON object request" }, 400) };
  }
}

export async function readJson(request, maxBytes = 64 * 1024) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) throw Object.assign(new Error("JSON request required"), { status: 415 });
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
  if (!request.body) throw Object.assign(new Error("Request body required"), { status: 400 });
  try {
    const value = await request.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Object required");
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > maxBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    return value;
  } catch (error) {
    if (error?.status) throw error;
    throw Object.assign(new Error("Invalid JSON object request"), { status: 400 });
  }
}

export function secureJson(payload, status = 200, headers = {}) {
  return secureResponse(Response.json(payload, { status, headers: { "Cache-Control": "no-store", ...headers } }));
}

export function json(payload, status = 200, cache = "no-store") {
  return secureJson(payload, status, { "Cache-Control": cache });
}

export function secureText(text, status = 200, cache = "no-store") {
  return secureResponse(new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": cache } }));
}

export function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function requireUser(identity, response = secureJson({ error: "Authentication is required." }, 401)) {
  return identity ? null : response;
}

export function requireAdmin(identity, response = secureJson({ error: "Administrator access is required." }, 403)) {
  return identity?.is_admin || identity?.isAdmin ? null : response;
}

export async function featureCircuit(env, id, who = "system:read") {
  return getCircuitBreaker(env, id, { who }).catch((error) => {
    eventLog("error", "feature.circuit.read.failed", { breaker: id, errorName: error?.name || "Error", errorMessage: String(error?.message || "Unknown circuit breaker error").slice(0, 300) });
    void env?.event?.("feature.circuit.read.failed", "feature", { breaker: id, who, errorName: error?.name || "Error" });
    return null;
  });
}

export async function featureAvailable(env, id, who = "system:read") {
  return (await featureCircuit(env, id, who))?.state === "on";
}

export async function requireFeatureCircuit(env, { feature, breakerId, operation, requestId, who, message = "The requested feature is unavailable." }) {
  const breaker = await featureCircuit(env, breakerId, who || "system:read");
  if (breaker?.state === "on") return breaker;
  const details = { feature, breaker: breakerId, state: breaker?.state || "missing", operation, requestId: requestId || null };
  eventLog("warn", "feature.request.blocked", details);
  auditLog({ who: who || "system:read", operation: "blocked", resource: `feature:${feature}`, details });
  await env?.event?.("feature.request.blocked", "feature", { ...details, who: who || "system:read" });
  throw Object.assign(new Error(message), { status: 503, code: "feature_circuit_unavailable", feature, breakerId, circuitState: breaker?.state || "missing" });
}

export function createAvailabilityFeature({ name = "base", breakerId = `${name}:site-available`, displayName = "Site availability", publicPaths = ["/health", "/api/health"] } = {}) {
  return {
    name,
    packageName: BASE_PACKAGE_NAME,
    version: BASE_VERSION,
    healthcheck: async () => ({ feature: name, component: "site-available", displayName, state: "green", metadata: { endpoint: "/health", expectedStatus: 200 } }),
    circuitBreakers: [{ id: breakerId, name: "site-available", displayName, state: "on", allowSelfHealing: false, healthchecks: [`${name}:site-available`] }],
    async middleware(request, env, ctx, next) {
      const pathname = new URL(request.url).pathname;
      if (publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return next(request);
      const breaker = await featureCircuit(env, breakerId, "system:read");
      if (breaker?.state === "on") return next(request);
      await env.event?.("feature.maintenance", "availability", { feature: name, breaker: breakerId, state: breaker?.state || "missing", pathname, method: request.method });
      return secureJson({ error: "The site is temporarily unavailable." }, 503);
    },
  };
}

export function createD1(env, { who = "system:read" } = {}) {
  if (!env?.DB) throw new Error("A DB binding is required");
  const db = env.DB;
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      return new Proxy(statement, { get(target, property) {
        const value = target[property];
        if (typeof value !== "function" || !["run", "first", "all", "raw"].includes(property)) return typeof value === "function" ? value.bind(target) : value;
        return async (...args) => {
          auditD1(who, sql);
          return value.apply(target, args);
        };
      }});
    },
    async batch(statements) {
      auditD1(who, "BATCH");
      return typeof db.batch === "function" ? db.batch(statements) : Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

export function auditedD1(db, who = "system:read") {
  if (!db) return db;
  return new Proxy(db, {
    get(target, property) {
      const value = target[property];
      if (property === "prepare") return (sql) => {
        const statement = value.call(target, sql);
        return new Proxy(statement, {
          get(statementTarget, statementProperty) {
            const method = statementTarget[statementProperty];
            if (!['run', 'first', 'all', 'raw'].includes(statementProperty) || typeof method !== "function") return typeof method === "function" ? method.bind(statementTarget) : method;
            return async (...args) => { auditD1(who, sql); return method.apply(statementTarget, args); };
          },
        });
      };
      if (property === "batch") return (statements) => { auditD1(who, "BATCH"); return typeof value === "function" ? value.call(target, statements) : Promise.all(statements.map((statement) => statement.run())); };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function auditedEnv(env, who = "system:read") {
  if (!env?.DB) return env;
  const result = Object.create(env);
  result.DB = auditedD1(env.DB, who);
  return result;
}

function auditD1(who, sql) {
  const operation = String(sql).trim().match(/^(SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)/i)?.[1]?.toLowerCase() || "execute";
  eventLog("debug", "d1.operation", { who, operation });
  auditLog({ who, operation, resource: "d1" });
}

export function normalizeHealthcheck(input = {}) {
  const state = String(input.state || "yellow").toLowerCase();
  if (!HEALTHCHECK_STATES.includes(state)) throw new Error("Healthcheck state must be red, yellow, or green");
  if (!input.feature || !input.component || !input.displayName) throw new Error("Healthchecks require feature, component, and displayName");
  return { feature: String(input.feature), component: String(input.component), displayName: String(input.displayName), state, metadata: input.metadata || {} };
}

export function normalizeCircuitBreaker(input = {}) {
  const state = String(input.state || "off").toLowerCase();
  const healthcheckMode = String(input.healthcheckMode || "any").toLowerCase();
  if (!CIRCUIT_BREAKER_STATES.includes(state)) throw new Error("Circuit breaker state must be off, tripped, or on");
  if (!HEALTHCHECK_MODES.includes(healthcheckMode)) throw new Error("Circuit breaker healthcheckMode must be any or all");
  if (!input.feature || !input.name || !input.displayName) throw new Error("Circuit breakers require feature, name, and displayName");
  return { feature: String(input.feature), name: String(input.name), displayName: String(input.displayName), state, healthcheckMode, allowSelfHealing: Boolean(input.allowSelfHealing), healthchecks: Array.isArray(input.healthchecks) ? input.healthchecks.map(String) : [], dependsOnCircuitBreakers: Array.isArray(input.dependsOnCircuitBreakers || input.dependencies) ? (input.dependsOnCircuitBreakers || input.dependencies).map(String) : [], metadata: input.metadata || {} };
}

export async function registerHealthcheck(env, input, { who = "system:read" } = {}) {
  const item = normalizeHealthcheck(input);
  const db = createD1(env, { who });
  const id = String(input.id || `${item.feature}:${item.component}`);
  await db.prepare(`INSERT INTO core_healthchecks (id,feature,component,display_name,state,metadata_json) VALUES (?,?,?,?,?,?) ON CONFLICT(feature,component) DO UPDATE SET display_name=excluded.display_name,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP`).bind(id, item.feature, item.component, item.displayName, item.state, JSON.stringify(item.metadata)).run();
  return getHealthcheck(env, id, { who });
}

export async function updateHealthcheck(env, id, state, { who = "system:read" } = {}) {
  if (!HEALTHCHECK_STATES.includes(String(state).toLowerCase())) throw new Error("Healthcheck state must be red, yellow, or green");
  const item = await getHealthcheck(env, id, { who });
  if (!item) return null;
  const db = createD1(env, { who });
  await db.prepare("UPDATE core_healthchecks SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(state).toLowerCase(), id).run();
  auditLog({ who, operation: "update", resource: `feature:${item.feature} component:${item.component} ${String(state).toLowerCase()}` });
  return getHealthcheck(env, id, { who });
}

export async function getHealthcheck(env, id, { who = "system:read" } = {}) { return (await createD1(env, { who }).prepare("SELECT * FROM core_healthchecks WHERE id=?").bind(id).first()) || null; }
export async function listHealthchecks(env, { who = "system:read" } = {}) { return (await createD1(env, { who }).prepare("SELECT * FROM core_healthchecks ORDER BY feature,component").bind().all()).results || []; }

export async function registerCircuitBreaker(env, input, { who = "system:read" } = {}) {
  const item = normalizeCircuitBreaker(input);
  const db = createD1(env, { who });
  const id = String(input.id || `${item.feature}:${item.name}`);
  await db.prepare(`INSERT INTO core_circuit_breakers (id,feature,name,display_name,state,healthcheck_mode,allow_self_healing,metadata_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(feature,name) DO UPDATE SET display_name=excluded.display_name,healthcheck_mode=excluded.healthcheck_mode,allow_self_healing=excluded.allow_self_healing,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP`).bind(id, item.feature, item.name, item.displayName, item.state, item.healthcheckMode, item.allowSelfHealing ? 1 : 0, JSON.stringify(item.metadata)).run();
  await db.batch([db.prepare("DELETE FROM core_circuit_breaker_healthchecks WHERE circuit_breaker_id=?").bind(id), db.prepare("DELETE FROM core_circuit_breaker_dependencies WHERE circuit_breaker_id=?").bind(id), ...item.healthchecks.map((healthcheckId) => db.prepare("INSERT OR IGNORE INTO core_circuit_breaker_healthchecks (circuit_breaker_id,healthcheck_id) VALUES (?,?)").bind(id, healthcheckId)), ...item.dependsOnCircuitBreakers.map((dependencyId) => db.prepare("INSERT OR IGNORE INTO core_circuit_breaker_dependencies (circuit_breaker_id,dependency_id) VALUES (?,?)").bind(id, dependencyId))]);
  return getCircuitBreaker(env, id, { who });
}

export async function getCircuitBreaker(env, id, { who = "system:read" } = {}) { const db = createD1(env, { who }); const breaker = await db.prepare("SELECT * FROM core_circuit_breakers WHERE id=?").bind(id).first(); if (!breaker) return null; breaker.healthchecks = (await db.prepare("SELECT healthcheck_id FROM core_circuit_breaker_healthchecks WHERE circuit_breaker_id=?").bind(id).all()).results.map((row) => row.healthcheck_id) ; breaker.depends_on_circuit_breakers = (await db.prepare("SELECT dependency_id FROM core_circuit_breaker_dependencies WHERE circuit_breaker_id=?").bind(id).all()).results.map((row) => row.dependency_id); return breaker; }
export async function listCircuitBreakers(env, { who = "system:read" } = {}) { const rows = (await createD1(env, { who }).prepare("SELECT * FROM core_circuit_breakers ORDER BY feature,name").bind().all()).results || []; return Promise.all(rows.map((row) => getCircuitBreaker(env, row.id, { who }))); }

export async function setCircuitBreaker(env, id, state, { who = "system:read", automated = false } = {}) {
  const next = String(state).toLowerCase();
  if (!CIRCUIT_BREAKER_STATES.includes(next)) throw new Error("Circuit breaker state must be off, tripped, or on");
  const current = await getCircuitBreaker(env, id, { who });
  if (!current) return null;
  if (automated && !((current.state === "on" && next === "tripped") || (current.state === "tripped" && next === "on" && Boolean(current.allow_self_healing)))) return current;
  if (automated && next === "off") return current;
  await createD1(env, { who }).prepare("UPDATE core_circuit_breakers SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(next, id).run();
  auditLog({ who, operation: "update", resource: `feature:${current.feature} circuit_breaker:${current.name} ${next}` });
  return getCircuitBreaker(env, id, { who });
}

export async function evaluateCircuitBreaker(env, id, { who = "system:read" } = {}) {
  const breaker = await getCircuitBreaker(env, id, { who });
  if (!breaker) return null;
  const db = createD1(env, { who });
  const rows = (await db.prepare("SELECT h.state FROM core_healthchecks h JOIN core_circuit_breaker_healthchecks b ON b.healthcheck_id=h.id WHERE b.circuit_breaker_id=?").bind(id).all()).results || [];
  const failing = rows.map((row) => row.state === "red");
  const dependencies = (await db.prepare("SELECT b.state FROM core_circuit_breakers b JOIN core_circuit_breaker_dependencies d ON d.dependency_id=b.id WHERE d.circuit_breaker_id=?").bind(id).all()).results || [];
  const dependencyFailed = dependencies.some((row) => row.state === "tripped");
  const shouldTrip = dependencyFailed || (failing.length > 0 &&  (breaker.healthcheck_mode === "all" ? failing.every(Boolean) : failing.some(Boolean)));
  if (breaker.state === "on" && shouldTrip) return setCircuitBreaker(env, id, "tripped", { who, automated: true });
  if (breaker.state === "tripped" && !shouldTrip && breaker.allow_self_healing) return setCircuitBreaker(env, id, "on", { who, automated: true });
  return breaker;
}


export async function registerFeatureManifests(env, features = [], { who = "system:read" } = {}) {
  for (const feature of features) {
    const name = String(feature?.name || feature?.id || "feature");
    const declaredResult = typeof feature?.healthcheck === "function" ? await feature.healthcheck(env, { who }) : (feature?.healthchecks || feature?.healthChecks || []);
    const declaredHealthchecks = Array.isArray(declaredResult) ? declaredResult : [declaredResult];
    const healthchecks = [];
    const breakers = [];
    for (const healthcheck of declaredHealthchecks) healthchecks.push(await registerHealthcheck(env, { ...healthcheck, feature: healthcheck.feature || name }, { who }));
    for (const breaker of feature?.circuitBreakers || feature?.circuit_breakers || []) breakers.push(await registerCircuitBreaker(env, { ...breaker, feature: breaker.feature || name }, { who }));
    await registerCircuitBreaker(env, { id: `${name}:rollup`, feature: name, name: "rollup", displayName: `${name} feature`, state: "on", allowSelfHealing: true, healthchecks: healthchecks.filter(Boolean).map((item) => item.id), dependsOnCircuitBreakers: breakers.filter(Boolean).map((item) => item.id) }, { who });
  }
}

export async function listFeatureHealth(env, { who = "system:read" } = {}) {
  const checks = await listHealthchecks(env, { who });
  const severity = { green: 0, yellow: 1, red: 2 };
  const features = {};
  for (const check of checks) { const name = check.feature; if (!features[name] || severity[check.state] > severity[features[name].state]) features[name] = { feature: name, state: check.state, healthchecks: 0 }; features[name].healthchecks += 1; }
  return Object.values(features).sort((a, b) => a.feature.localeCompare(b.feature));
}


export function normalizeFeatureManifest(feature = {}) {
  const source = feature && typeof feature === "object" ? feature : {};
  const manifest = source.manifest && typeof source.manifest === "object" ? source.manifest : source;
  const name = String(source.name || source.id || manifest.name || "feature");
  const packageName = source.packageName || source.package_name || source.package || manifest.packageName || manifest.package_name || manifest.package;
  const version = source.version || source.packageVersion || source.package_version || manifest.version;
  return {
    feature: name,
    display_name: String(source.displayName || source.display_name || manifest.displayName || manifest.display_name || name),
    package_name: packageName ? String(packageName) : null,
    version: version ? String(version) : null,
  };
}

export async function listFeatureCatalog(env, features = [], { who = "system:read" } = {}) {
  const [healthchecks, circuitBreakers] = await Promise.all([listHealthchecks(env, { who }), listCircuitBreakers(env, { who })]);
  const manifests = new Map([["base", { feature: "base", display_name: "Base platform", package_name: BASE_PACKAGE_NAME, version: BASE_VERSION }]]);
  for (const feature of features) {
    const manifest = normalizeFeatureManifest(feature);
    manifests.set(manifest.feature, manifest);
  }
  for (const item of healthchecks) if (!manifests.has(item.feature)) manifests.set(item.feature, normalizeFeatureManifest({ name: item.feature }));
  for (const item of circuitBreakers) if (!manifests.has(item.feature)) manifests.set(item.feature, normalizeFeatureManifest({ name: item.feature }));
  const severity = { green: 0, yellow: 1, red: 2 };
  const state = (items) => items.reduce((current, item) => severity[item.state] > severity[current] ? item.state : current, "green");
  return [...manifests.values()].sort((a, b) => a.feature.localeCompare(b.feature)).map((manifest) => {
    const featureHealthchecks = healthchecks.filter((item) => item.feature === manifest.feature);
    const featureBreakers = circuitBreakers.filter((item) => item.feature === manifest.feature);
    const rollup = featureBreakers.find((item) => item.name === "rollup") || null;
    return { ...manifest, health: featureHealthchecks.length ? state(featureHealthchecks) : "yellow", healthchecks: featureHealthchecks, circuit_breakers: featureBreakers, circuit_breaker: rollup };
  });
}
