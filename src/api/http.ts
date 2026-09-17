export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body !== null && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
}

export function stringField(body: Record<string, unknown> | null, field: string): string | null {
  const value = body?.[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function stringArrayField(body: Record<string, unknown> | null, field: string): string[] | null {
  const value = body?.[field];
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === "string")
    ? value
    : null;
}

export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: NO_STORE_HEADERS });
}

export function badRequest(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

export function notFound(error: string): Response {
  return Response.json({ error }, { status: 404 });
}

export function jsonWithCookie(body: object, cookie: string): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
    },
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to complete the request";
}
