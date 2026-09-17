const decoder = new TextDecoder();

export function cookies(request: Request): Record<string, string> {
  return Object.fromEntries(
    (request.headers.get("Cookie") || "").split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? []
        : [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
    }),
  );
}

export function cookie(name: string, value: string, age: number): string {
  return `${name}=${value}; Max-Age=${age}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export function redirect(location: string | URL, setCookies: readonly string[]): Response {
  const response = new Response(null, {
    status: 302,
    headers: { Location: String(location), "Cache-Control": "no-store" },
  });
  for (const value of setCookies) response.headers.append("Set-Cookie", value);
  return response;
}

export function safeReturnTo(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/auth/")
    ? value
    : "/";
}

export function decodeReturn(value: string | undefined): string {
  try {
    return safeReturnTo(decoder.decode(decodeBase64Url(value || "")));
  } catch {
    return "/";
  }
}

export function base64url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

