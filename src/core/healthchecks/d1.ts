import { createD1, type D1Environment } from "../database/index.js";
import type {
  Healthcheck,
  HealthcheckRow,
  HealthcheckAccessOptions,
  NormalizedHealthcheck,
} from "./model.js";

export async function saveHealthcheck(
  env: D1Environment,
  id: string,
  item: NormalizedHealthcheck,
  { who = "system:read" }: HealthcheckAccessOptions = {},
): Promise<void> {
  await createD1(env, { who })
    .prepare(
      "INSERT INTO core_healthchecks (id,feature,component,display_name,state,metadata_json) VALUES (?,?,?,?,?,?) ON CONFLICT(feature,component) DO UPDATE SET display_name=excluded.display_name,metadata_json=excluded.metadata_json,updated_at=CURRENT_TIMESTAMP",
    )
    .bind(
      id,
      item.feature,
      item.component,
      item.displayName,
      item.state,
      JSON.stringify(item.metadata),
    )
    .run();
}

export async function writeHealthcheckState(
  env: D1Environment,
  id: string,
  state: string,
  { who = "system:read" }: HealthcheckAccessOptions = {},
): Promise<void> {
  await createD1(env, { who })
    .prepare("UPDATE core_healthchecks SET state=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(state, id)
    .run();
}

export async function readHealthcheck(
  env: D1Environment,
  id: string,
  { who = "system:read" }: HealthcheckAccessOptions = {},
): Promise<Healthcheck | null> {
  const row = await createD1(env, { who })
    .prepare("SELECT * FROM core_healthchecks WHERE id=?")
    .bind(id)
    .first<HealthcheckRow>();
  return row ? normalizeHealthcheckRow(row) : null;
}

export async function readHealthchecks(
  env: D1Environment,
  { who = "system:read" }: HealthcheckAccessOptions = {},
): Promise<Healthcheck[]> {
  const result = await createD1(env, { who })
    .prepare("SELECT * FROM core_healthchecks ORDER BY feature,component")
    .bind()
    .all<HealthcheckRow>();
  return (result.results || []).map(normalizeHealthcheckRow);
}

function normalizeHealthcheckRow(row: HealthcheckRow): Healthcheck {
  const { metadata_json: metadataJson, ...healthcheck } = row;
  return { ...healthcheck, metadata: jsonObject(metadataJson) };
}

function jsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
