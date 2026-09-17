import {
  ApiError,
  apiFetch,
  apiJson,
  assertJsonError,
  assertSecurityHeaders,
} from "../src/api/index.js";
import type {
  ApiJsonRequestOptions,
  ApiRequestInput,
  ApiRequestOptions,
  ApiSuccessResult,
  JsonCompatible,
  JsonErrorAssertionResult,
  JsonErrorEnvelope,
  JsonObject,
  JsonValue,
  SecurityHeaderAssertionResult,
  TypedApiRequestOptions,
} from "../src/api/index.js";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Assert<Value extends true> = Value;

interface ItemResult {
  item: { id: string };
}

interface ItemPayload {
  name: string;
  servings: number;
  tags: string[];
}

function isItemResult(value: unknown): value is ItemResult {
  return Boolean(
    value
    && typeof value === "object"
    && "item" in value
    && value.item
    && typeof value.item === "object"
    && "id" in value.item
    && typeof value.item.id === "string",
  );
}

const typedOptions: TypedApiRequestOptions<ItemResult> = { validateJson: isItemResult };
const typedResult = apiFetch("/api/items/1", typedOptions);
const inferredResult = apiFetch("/api/items/1", { validateJson: isItemResult });
const defaultResult = apiFetch("/api/items/1");
const jsonResult = apiJson("/api/items", { name: "Soup", servings: 4 }, {
  validateJson: isItemResult,
});

type _typedResult = Assert<Equal<Awaited<typeof typedResult>, ApiSuccessResult<ItemResult>>>;
type _inferredResult = Assert<Equal<Awaited<typeof inferredResult>, ItemResult | Response>>;
type _defaultResult = Assert<Equal<Awaited<typeof defaultResult>, JsonValue | Response>>;
type _jsonResult = Assert<Equal<Awaited<typeof jsonResult>, ItemResult | Response>>;

const payload = {
  name: "Soup",
  ingredients: ["stock", "vegetables"],
  metadata: { servings: 4, published: true, note: null },
} satisfies JsonObject;
void apiJson("/api/items", payload, { method: "PUT" } satisfies ApiJsonRequestOptions);
const interfacePayload: ItemPayload = { name: "Soup", servings: 4, tags: ["dinner"] };
void apiJson("/api/items", interfacePayload);
const compatiblePayload: JsonCompatible<ItemPayload> = interfacePayload;

const requestInput: ApiRequestInput = new URL("https://example.test/api/items");
const requestOptions: ApiRequestOptions = { headers: new Headers(), credentials: "same-origin" };
const apiError: ApiError = new ApiError("Denied", 403, "request-1");
const errorEnvelope: JsonErrorEnvelope = { error: "Denied", code: "forbidden" };
const assertedHeaders = assertSecurityHeaders(new Response());
const assertedError = assertJsonError(Response.json(errorEnvelope, { status: 403 }), 403);

type _securityResult = Assert<Equal<
  SecurityHeaderAssertionResult<Response>,
  typeof assertedHeaders
>>;
type _errorResult = Assert<Equal<Awaited<typeof assertedError>, JsonErrorAssertionResult>>;

void [requestInput, requestOptions, apiError, compatiblePayload];
