export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];

export type JsonCompatible<Value> =
  Value extends JsonPrimitive ? Value
    : Value extends readonly (infer Element)[] ? readonly JsonCompatible<Element>[]
    : Value extends object ? { readonly [Key in keyof Value]: JsonCompatible<Value[Key]> }
    : never;

export type JsonErrorEnvelope = JsonObject & {
  readonly error: string;
};

export type ApiRequestInput = Parameters<typeof fetch>[0];

export interface ApiRequestOptions extends RequestInit {
  validateJson?: never;
}

export type JsonValidator<Result> = (value: unknown) => value is Result;

export interface TypedApiRequestOptions<Result> extends RequestInit {
  validateJson: JsonValidator<Result>;
}

export type ApiJsonRequestOptions = Omit<ApiRequestOptions, "body">;

export type TypedApiJsonRequestOptions<Result> = Omit<
  TypedApiRequestOptions<Result>,
  "body"
>;

export type ApiSuccessResult<Result = JsonValue> = Result | Response;

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | null;

  constructor(message: string, status: number, requestId: string | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

export function isJsonErrorEnvelope(value: unknown): value is JsonErrorEnvelope {
  return isJsonObject(value) && typeof value.error === "string" && value.error.length > 0;
}

function requestHeaders(options: RequestInit): Headers {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined && options.body !== null) {
    headers.set("Content-Type", "application/json");
  }
  if (options.headers) {
    new Headers(options.headers).forEach((value, name) => headers.set(name, value));
  }
  return headers;
}

export function apiFetch<Result>(
  input: ApiRequestInput,
  options: TypedApiRequestOptions<Result>,
): Promise<ApiSuccessResult<Result>>;
export function apiFetch(
  input: ApiRequestInput,
  options?: ApiRequestOptions,
): Promise<ApiSuccessResult>;
export async function apiFetch<Result>(
  input: ApiRequestInput,
  options: ApiRequestOptions | TypedApiRequestOptions<Result> = {},
): Promise<ApiSuccessResult | ApiSuccessResult<Result>> {
  return performApiFetch(input, options);
}

async function performApiFetch<Result>(
  input: ApiRequestInput,
  options: ApiRequestOptions | TypedApiRequestOptions<Result>,
): Promise<ApiSuccessResult | ApiSuccessResult<Result>> {
  const { validateJson, ...requestOptions } = options;
  const response = await fetch(input, {
    credentials: "same-origin",
    ...requestOptions,
    headers: requestHeaders(requestOptions),
  });
  const payload: unknown = await response.clone().json().catch(() => null);

  if (!response.ok) {
    const message = isJsonErrorEnvelope(payload)
      ? payload.error
      : `Request failed (${response.status})`;
    throw new ApiError(
      message,
      response.status,
      response.headers.get("X-Request-ID") || null,
    );
  }

  if (payload === null) return response;
  if (validateJson) {
    if (!validateJson(payload)) throw new TypeError("API response did not match the expected JSON shape");
    return payload;
  }
  return isJsonValue(payload) ? payload : response;
}

export function apiJson<Result, Payload>(
  input: ApiRequestInput,
  payload: Payload & JsonCompatible<Payload>,
  options: TypedApiJsonRequestOptions<Result>,
): Promise<ApiSuccessResult<Result>>;
export function apiJson<Payload>(
  input: ApiRequestInput,
  payload: Payload & JsonCompatible<Payload>,
  options?: ApiJsonRequestOptions,
): Promise<ApiSuccessResult>;
export function apiJson<Result, Payload>(
  input: ApiRequestInput,
  payload: Payload & JsonCompatible<Payload>,
  options: ApiJsonRequestOptions | TypedApiJsonRequestOptions<Result> = {},
): Promise<ApiSuccessResult | ApiSuccessResult<Result>> {
  return performApiFetch(input, {
    ...options,
    method: options.method || "POST",
    body: JSON.stringify(payload),
  });
}
