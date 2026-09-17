import type { BootSpec, BootValidation, HealthDetails, RuntimeBindings } from "./model.js";

export function validateBoot(env: RuntimeBindings, { bindings = [], required = [] }: BootSpec = {}): BootValidation {
  const missingBindings = bindings.filter((name) => !env?.[name]);
  const missingValues = required.filter((name) =>
    !env?.[name] || String(env[name]).startsWith("replace-with-")
  );
  return {
    ok: missingBindings.length === 0 && missingValues.length === 0,
    missingBindings,
    missingValues,
  };
}

export function assertBoot(env: RuntimeBindings, spec: BootSpec = {}): BootValidation {
  const result = validateBoot(env, spec);
  if (!result.ok) {
    throw new Error(
      `Worker boot validation failed: ${[...result.missingBindings, ...result.missingValues].join(", ")}`,
    );
  }
  return result;
}

export function methodNotAllowed(allow = "GET"): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: allow } });
}

export function healthResponse(env: RuntimeBindings, details: HealthDetails = {}): Response {
  return Response.json({
    ok: true,
    version: String(env.BUILD_SHA || "unknown").slice(0, 7),
    build_number: env.BUILD_NUMBER ? String(env.BUILD_NUMBER) : null,
    ...details,
  }, { headers: { "Cache-Control": "no-store" } });
}

