import { createD1, type D1Environment } from "../database/index.js";
import type {
  CircuitAccessOptions,
  CircuitBreaker,
  CircuitBreakerRow,
  NormalizedCircuitBreaker,
} from "./model.js";

interface IdRow { id: string }
interface HealthcheckIdRow { healthcheck_id: string }
interface DependencyIdRow { dependency_id: string }
interface StateRow { state: string }

export async function saveCircuitBreaker(
  env: D1Environment,
  id: string,
  item: NormalizedCircuitBreaker,
  { who = "system:read" }: CircuitAccessOptions = {},
): Promise<void> {
  const db = createD1(env, { who });
  await db
    .prepare(
      "INSERT INTO core_circuit_breakers (id,feature,name,display_name,state,healthcheck_mode,allow_self_healing,metadata_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(feature,name) DO UPDATE SET display_name=excluded.display_name,healthcheck_mode=excluded.healthcheck_mode,allow_self_healing=excluded.allow_self_healing,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP",
    )
    .bind(
      id,
      item.feature,
      item.name,
      item.displayName,
      item.state,
      item.healthcheckMode,
      item.allowSelfHealing ? 1 : 0,
      JSON.stringify(item.metadata),
    )
    .run();

  // Replace relation rows as a unit so callers never have to reconcile stale declarations.
  await db.batch([
    db.prepare("DELETE FROM core_circuit_breaker_healthchecks WHERE circuit_breaker_id=?").bind(id),
    db.prepare("DELETE FROM core_circuit_breaker_dependencies WHERE circuit_breaker_id=?").bind(id),
    ...item.healthchecks.map((healthcheckId) =>
      db.prepare("INSERT OR IGNORE INTO core_circuit_breaker_healthchecks (circuit_breaker_id,healthcheck_id) VALUES (?,?)").bind(id, healthcheckId),
    ),
    ...item.dependsOnCircuitBreakers.map((dependencyId) =>
      db.prepare("INSERT OR IGNORE INTO core_circuit_breaker_dependencies (circuit_breaker_id,dependency_id) VALUES (?,?)").bind(id, dependencyId),
    ),
  ]);
}

export async function readCircuitBreaker(
  env: D1Environment,
  id: string,
  { who = "system:read" }: CircuitAccessOptions = {},
): Promise<CircuitBreaker | null> {
  const db = createD1(env, { who });
  const breaker = await db.prepare("SELECT * FROM core_circuit_breakers WHERE id=?").bind(id).first<CircuitBreakerRow>();
  if (!breaker) return null;

  const healthchecks = await db
    .prepare("SELECT healthcheck_id FROM core_circuit_breaker_healthchecks WHERE circuit_breaker_id=?")
    .bind(id)
    .all<HealthcheckIdRow>();
  const dependencies = await db
    .prepare("SELECT dependency_id FROM core_circuit_breaker_dependencies WHERE circuit_breaker_id=?")
    .bind(id)
    .all<DependencyIdRow>();

  return {
    ...normalizeCircuitBreakerRow(breaker),
    healthchecks: (healthchecks.results || []).map((row) => row.healthcheck_id),
    depends_on_circuit_breakers: (dependencies.results || []).map((row) => row.dependency_id),
  };
}

function normalizeCircuitBreakerRow(row: CircuitBreakerRow): Omit<CircuitBreaker, "healthchecks" | "depends_on_circuit_breakers"> {
  const { metadata_json: metadataJson, allow_self_healing: allowSelfHealing, ...breaker } = row;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(String(metadataJson || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
  } catch { /* Invalid legacy metadata is treated as empty. */ }
  return { ...breaker, allow_self_healing: Boolean(allowSelfHealing), metadata };
}

export async function readCircuitBreakerIds(
  env: D1Environment,
  { who = "system:read" }: CircuitAccessOptions = {},
): Promise<string[]> {
  const result = await createD1(env, { who })
    .prepare("SELECT * FROM core_circuit_breakers ORDER BY feature,name")
    .bind()
    .all<IdRow>();
  return (result.results || []).map((row) => row.id);
}

export async function writeCircuitBreakerState(
  env: D1Environment,
  id: string,
  state: string,
  { who = "system:read" }: CircuitAccessOptions = {},
): Promise<void> {
  await createD1(env, { who })
    .prepare("UPDATE core_circuit_breakers SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(state, id)
    .run();
}

export async function readHealthcheckStates(
  env: D1Environment,
  id: string,
  { who = "system:read" }: CircuitAccessOptions = {},
): Promise<string[]> {
  const result = await createD1(env, { who })
    .prepare("SELECT h.state FROM core_healthchecks h JOIN core_circuit_breaker_healthchecks b ON b.healthcheck_id=h.id WHERE b.circuit_breaker_id=?")
    .bind(id)
    .all<StateRow>();
  return (result.results || []).map((row) => row.state);
}

export async function readDependencyStates(
  env: D1Environment,
  id: string,
  { who = "system:read" }: CircuitAccessOptions = {},
): Promise<string[]> {
  const result = await createD1(env, { who })
    .prepare("SELECT b.state FROM core_circuit_breakers b JOIN core_circuit_breaker_dependencies d ON d.dependency_id=b.id WHERE d.circuit_breaker_id=?")
    .bind(id)
    .all<StateRow>();
  return (result.results || []).map((row) => row.state);
}
