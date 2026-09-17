import type { D1Environment } from "../database/index.js";
import { auditLog } from "../events/index.js";
import {
  readHealthcheck,
  readHealthchecks,
  saveHealthcheck,
  writeHealthcheckState,
} from "./d1.js";
import type {
  Healthcheck,
  HealthcheckAccessOptions,
  HealthcheckInput,
} from "./model.js";
import { healthcheckState, normalizeHealthcheck } from "./validation.js";

export async function registerHealthcheck(
  env: D1Environment,
  input: HealthcheckInput,
  options: HealthcheckAccessOptions = {},
): Promise<Healthcheck | null> {
  const item = normalizeHealthcheck(input);
  const id = String(input.id || `${item.feature}:${item.component}`);
  await saveHealthcheck(env, id, item, options);
  return getHealthcheck(env, id, options);
}

export async function updateHealthcheck(
  env: D1Environment,
  id: string,
  state: unknown,
  { who = "system:read" }: HealthcheckAccessOptions = {},
): Promise<Healthcheck | null> {
  const next = healthcheckState(state);
  const item = await getHealthcheck(env, id, { who });
  if (!item) return null;

  await writeHealthcheckState(env, id, next, { who });
  auditLog({
    who,
    operation: "update",
    resource: `feature:${item.feature} component:${item.component} ${next}`,
  });
  return getHealthcheck(env, id, { who });
}

export const getHealthcheck = readHealthcheck;
export const listHealthchecks = readHealthchecks;

