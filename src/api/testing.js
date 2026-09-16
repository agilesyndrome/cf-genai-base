export function assertSecurityHeaders(response) {
  for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy", "Strict-Transport-Security"]) {
    if (!response?.headers?.get(header)) throw new Error(`Missing security header: ${header}`);
  }
  return response;
}

export async function assertJsonError(response, status) {
  if (response.status !== status) throw new Error(`Expected ${status}, received ${response.status}`);
  const payload = await response.clone().json();
  if (!payload?.error) throw new Error("Expected a JSON error envelope");
  return payload;
}
