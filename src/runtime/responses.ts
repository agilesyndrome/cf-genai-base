export const htmlHeaders = Object.freeze({
  "content-type": "text/html; charset=utf-8",
});

/**
 * Create an HTML response while preserving the caller's status, headers, and
 * response metadata. The helper supplies only the missing content type.
 */
export function htmlResponse(
  body: BodyInit | null,
  init: ResponseInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", htmlHeaders["content-type"]);
  return new Response(body, { ...init, headers });
}
