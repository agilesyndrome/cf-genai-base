import { SecurityRequestError } from "../src/core/security/index.js";
import type {
  AllowedOriginInput,
  IdentityLike,
  JsonObjectBody,
  ReadJsonCloneResult,
} from "../src/core/security/index.js";
import { readJsonClone, requireAdmin, sameOrigin } from "../src/core/security/index.js";

const origins: AllowedOriginInput = ["https://example.test"];
const identity: IdentityLike = { isAdmin: true };
const objectBody: JsonObjectBody = { value: "untrusted" };
const request = new Request("https://example.test/api", { headers: { Origin: "https://example.test" } });
const cloneResult = readJsonClone(request);
const authorized: Response | null = requireAdmin(identity);
const originResult: boolean = sameOrigin(request, origins);
const typedError: SecurityRequestError = new SecurityRequestError("invalid JSON", 400);

async function assertCloneContract(): Promise<void> {
  const result: ReadJsonCloneResult = await cloneResult;
  if (result.value !== undefined) void result.value.value;
  else void result.error.status;
}

void [objectBody, authorized, originResult, typedError, assertCloneContract];
