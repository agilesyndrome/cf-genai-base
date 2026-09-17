import { isJsonErrorEnvelope } from "./client.js";
import type { JsonErrorEnvelope } from "./client.js";

export const SECURITY_HEADER_NAMES = [
  "Content-Security-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Strict-Transport-Security",
] as const;

export type SecurityHeaderName = (typeof SECURITY_HEADER_NAMES)[number];
export type SecurityHeaderAssertionInput = Pick<Response, "headers">;
export type SecurityHeaderAssertionResult<ResponseType extends SecurityHeaderAssertionInput> =
  ResponseType;

export type JsonErrorAssertionInput = readonly [response: Response, status: number];

export type JsonErrorAssertionResult = JsonErrorEnvelope;

export function assertSecurityHeaders<ResponseType extends SecurityHeaderAssertionInput>(
  response: ResponseType,
): SecurityHeaderAssertionResult<ResponseType> {
  for (const header of SECURITY_HEADER_NAMES) {
    if (!response?.headers?.get(header)) throw new Error(`Missing security header: ${header}`);
  }
  return response;
}

export async function assertJsonError(
  ...[response, status]: JsonErrorAssertionInput
): Promise<JsonErrorAssertionResult> {
  if (response.status !== status) {
    throw new Error(`Expected ${status}, received ${response.status}`);
  }
  const payload: unknown = await response.clone().json().catch(() => null);
  if (!isJsonErrorEnvelope(payload)) throw new Error("Expected a JSON error envelope");
  return payload;
}
