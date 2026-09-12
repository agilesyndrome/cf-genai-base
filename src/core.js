export const HEALTHCHECK_STATES = ["red", "yellow", "green"];
export const CIRCUIT_BREAKER_STATES = ["off", "tripped", "on"];
export const HEALTHCHECK_MODES = ["any", "all"];

export function eventLog(level, event, details = {}) {
  const method = ["debug", "info", "warn", "error"].includes(level) ? level : "info";
  console[method](`[EventLog] ${event}`, details);
}

export function auditLog({ who = "system", operation, resource, details = {} }) {
  console.info(`[AuditLog] ${who}:${operation} ${resource}`, details);
}

export function requestActor(state = {}) {
  if (state.requestedBy) return String(state.requestedBy);
  if (state.authUser?.id) return `user:${state.authUser.id}`;
  if (state.user?.auth_strategy === "http_basic") return "user:admin";
  if (state.user?.sub) return `user:${state.user.sub}`;
  return "system:read";
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
      return db.batch(statements);
    },
  };
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
