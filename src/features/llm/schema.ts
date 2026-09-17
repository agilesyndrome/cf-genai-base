import type { InferJSONSchema, JSONSchemaInput } from "./model.js";

export function parseBestEffort(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return text; }
}

export function validateAndReturn<const Schema extends JSONSchemaInput>(
  text: string,
  schema: Schema,
): InferJSONSchema<Schema> {
  let value: unknown;
  try { value = JSON.parse(text) as unknown; } catch (error) { throw new Error(`response is not JSON: ${errorMessage(error)}`); }
  validate(value, schema, "$root");
  return value as InferJSONSchema<Schema>;
}

function validate(value: unknown, schema: JSONSchemaInput | undefined, path: string): void {
  if (!schema) return;
  if (schema.type === "object") {
    if (!isRecord(value)) throw new Error(`${path} must be an object`);
    for (const key of schema.required || []) if (!(key in value)) throw new Error(`${path}.${key} is required`);
    for (const key of Object.keys(value)) {
      if (schema.properties?.[key]) continue;
      if (schema.additionalProperties === false) throw new Error(`${path}.${key} is not allowed`);
      if (typeof schema.additionalProperties === "object") {
        validate(value[key], schema.additionalProperties, `${path}.${key}`);
      }
    }
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in value) validate(value[key], child, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} has too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} has too many items`);
    value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`));
    return;
  }
  if (schema.type === "string" && typeof value !== "string") throw new Error(`${path} must be a string`);
  if (schema.type === "integer" && !Number.isInteger(value)) throw new Error(`${path} must be an integer`);
  if (schema.type === "number" && (typeof value !== "number" || Number.isNaN(value))) throw new Error(`${path} must be a number`);
  if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  if (schema.type === "null" && value !== null) throw new Error(`${path} must be null`);
  if (schema.enum && !schema.enum.some((allowed) => Object.is(allowed, value))) {
    throw new Error(`${path} must be one of ${schema.enum.join(", ")}`);
  }
  if ((schema.type === "number" || schema.type === "integer")
    && schema.minimum !== undefined
    && (typeof value !== "number" || value < schema.minimum)) throw new Error(`${path} is below minimum`);
  if ((schema.type === "number" || schema.type === "integer")
    && schema.maximum !== undefined
    && (typeof value !== "number" || value > schema.maximum)) throw new Error(`${path} is above maximum`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
