import type { AuthScope, NewAuthScope } from "./model.js";
const SCOPE_PATTERN = /^[a-z0-9]+(?::[a-z0-9-]+)+$/;
export function normalizeScopes(scopes: readonly unknown[] = []): AuthScope[] {
  return scopes
    .map((scope): NewAuthScope | null => {
      if (typeof scope === "string") return { name: scope };
      return scope && typeof scope === "object" ? scope as NewAuthScope : null;
    })
    .filter((scope): scope is NewAuthScope =>
      scope !== null && SCOPE_PATTERN.test(String(scope.name ?? "")))
    .map((scope) => ({
      name: String(scope.name),
      label: String(scope.label ?? scope.name),
      description: String(scope.description ?? ""),
      system: Boolean(scope.system),
    }));
}

export function validateScopeName(value: unknown): string {
  const name = String(value ?? "").trim();
  if (!SCOPE_PATTERN.test(name)) {
    throw new TypeError("Scope names must use the form resource:action.");
  }
  return name;
}

export function validateScopeInput(value: unknown): NewAuthScope {
  const scope = normalizeScopes([value])[0];
  if (!scope) throw new TypeError("A valid scope name is required.");
  return scope;
}

export function validateScopeNames(values: readonly unknown[]): string[] {
  return [...new Set(values.map(validateScopeName))];
}
