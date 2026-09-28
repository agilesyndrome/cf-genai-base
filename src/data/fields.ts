export interface FieldOptions {
  required?: boolean;
}

export interface TextFieldOptions extends FieldOptions {
  maxLength?: number;
}

export interface NumberFieldOptions extends FieldOptions {
  integer?: boolean;
}

export interface FieldDescriptor<Value = unknown> {
  readonly kind: string;
  readonly required: boolean;
  readonly parse: (value: unknown, key: string) => Value | undefined;
}

export type AnyFieldDescriptor = FieldDescriptor<unknown>;

export function text(options: TextFieldOptions = {}): FieldDescriptor<string> {
  const maxLength = options.maxLength;
  if (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < 1)) {
    throw new TypeError("Text maxLength must be a positive integer");
  }
  return descriptor("text", options.required === true, (value, key) => {
    if (value === undefined && options.required !== true) return undefined;
    if (typeof value !== "string") throw new TypeError(`Field ${key} must be text`);
    if (maxLength !== undefined && value.length > maxLength) throw new TypeError(`Field ${key} is too long`);
    return value;
  });
}

export function numberField(options: NumberFieldOptions = {}): FieldDescriptor<number> {
  return descriptor("number", options.required === true, (value, key) => {
    if (value === undefined && options.required !== true) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`Field ${key} must be a finite number`);
    if (options.integer && !Number.isSafeInteger(value)) throw new TypeError(`Field ${key} must be an integer`);
    return value;
  });
}

export function booleanField(options: FieldOptions = {}): FieldDescriptor<boolean> {
  return descriptor("boolean", options.required === true, (value, key) => {
    if (value === undefined && options.required !== true) return undefined;
    if (typeof value !== "boolean") throw new TypeError(`Field ${key} must be boolean`);
    return value;
  });
}

export function enumField<const Values extends readonly string[]>(values: Values, options: FieldOptions = {}): FieldDescriptor<Values[number]> {
  const allowed = new Set(values);
  if (!values.length || allowed.size !== values.length) throw new TypeError("Enum fields require distinct values");
  return descriptor("enum", options.required === true, (value, key) => {
    if (value === undefined && options.required !== true) return undefined;
    if (typeof value !== "string" || !allowed.has(value)) throw new TypeError(`Field ${key} must be one of: ${values.join(", ")}`);
    return value as Values[number];
  });
}

function descriptor<Value>(kind: string, required: boolean, parse: FieldDescriptor<Value>["parse"]): FieldDescriptor<Value> {
  return Object.freeze({ kind, required, parse });
}
