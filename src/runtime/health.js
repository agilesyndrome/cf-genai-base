export function validateBoot(env, { bindings = [], required = [] } = {}) {
  const missingBindings = bindings.filter((name) => !env?.[name]);
  const missingValues = required.filter((name) => !env?.[name] || String(env[name]).startsWith("replace-with-"));
  return { ok: missingBindings.length === 0 && missingValues.length === 0, missingBindings, missingValues };
}

export function assertBoot(env, spec = {}) {
  const result = validateBoot(env, spec);
  if (!result.ok) throw new Error(`Worker boot validation failed: ${[...result.missingBindings, ...result.missingValues].join(", ")}`);
  return result;
}

export function methodNotAllowed(allow = "GET") { return new Response("Method Not Allowed", { status: 405, headers: { Allow: allow } }); }

export function healthResponse(env, details = {}) {
  return Response.json({ ok: true, version: String(env.BUILD_SHA || "unknown").slice(0, 7), build_number: env.BUILD_NUMBER ? String(env.BUILD_NUMBER) : null, ...details }, { headers: { "Cache-Control": "no-store" } });
}
