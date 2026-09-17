import { sameOrigin, secureJson, secureText } from "../../core/security/index.js";
import { OAuthSingleDomain } from "./domain.js";
import { OAUTH_SINGLE, PACKAGE_NAME, VERSION } from "./constants.js";
import {
  base64url,
  clearCookie,
  constantTimeEqual,
  cookie,
  cookies,
  decodeReturn,
  redirect,
  safeReturnTo,
} from "./cookies.js";
import type {
  AuthRequestState,
  OAuthEnvironment,
  OAuthIdentity,
  OAuthOptions,
} from "./model.js";
import {
  callbackUrl,
  configuration,
  envNameFor,
  random,
  required,
  sign,
  verifyIdToken,
} from "./protocol.js";
import {
  getSessionUser,
  hydrateUser,
  normalizeUser,
  publicUser,
  sessionIdentity,
} from "./session.js";

const encoder = new TextEncoder();

export { OAUTH_SINGLE, PACKAGE_NAME, VERSION } from "./constants.js";
export type * from "./model.js";

/**
 * Generic OIDC auth for Workers using Authorization Code + PKCE and a signed,
 * host-only cookie. Application-specific authorization remains in the hooks.
 */
export function createAuth(options: OAuthOptions = {}) {
  const prefix = options.cookiePrefix || "__Host-cfgenai";
  if (!/^(?:__Host-)?[A-Za-z0-9_-]+$/.test(prefix)) {
    throw new Error("cookiePrefix contains invalid characters");
  }
  const names = {
    state: options.stateCookieName || `${prefix}_state`,
    session: options.sessionCookieName || `${prefix}_session`,
  };
  const publicPaths = options.publicPaths || ["/auth/", "/favicon.svg", "/robots.txt", "/health"];
  const protectedPath = options.protectedPath || (() => true);
  const envName = (key: string, fallback: string) => options.env?.[key] || fallback;

  async function resolveUser(request: Request, env: OAuthEnvironment): Promise<OAuthIdentity | null> {
    const user = await hydrateUser(
      await getSessionUser(request, env, envName("sessionSecret", "AUTH_SESSION_SECRET"), names.session, options),
      env,
    );
    if (user && options.sessionAuthorize && !(await options.sessionAuthorize({ user, request, env }))) {
      return null;
    }
    return user;
  }

  function resolveRequestUser(
    request: Request,
    env: OAuthEnvironment,
    state?: AuthRequestState,
  ): OAuthIdentity | null | Promise<OAuthIdentity | null> {
    return state && Object.hasOwn(state, "user") ? state.user || null : resolveUser(request, env);
  }

  async function resolveLoginUser(
    user: OAuthIdentity,
    env: OAuthEnvironment,
    request: Request,
  ): Promise<OAuthIdentity> {
    const hydrated = await hydrateUser(user, env);
    if (!hydrated) throw new Error("Unable to hydrate the authenticated user");
    if (options.loginAuthorize && !(await options.loginAuthorize({ user: hydrated, request, env }))) {
      throw authError("Authentication is not currently permitted.", 403);
    }
    return hydrated;
  }

  async function login(request: Request, env: OAuthEnvironment): Promise<Response> {
    if (options.getSession && await resolveUser(request, env)) {
      const target = safeReturnTo(new URL(request.url).searchParams.get("return_to") || "/");
      return redirect(new URL(request.url).origin + target, [clearCookie(names.state)]);
    }

    const config = await configuration(env, options);
    const state = random();
    const verifier = random();
    const nonce = random();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
    const challenge = base64url(new Uint8Array(digest));
    const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to") || "/");
    const stateValue = `${state}.${verifier}.${nonce}.${base64url(encoder.encode(returnTo))}`;
    const authorize = new URL(config.authorization_endpoint);
    authorize.search = new URLSearchParams({
      client_id: required(env, envName("clientId", "OIDC_CLIENT_ID")),
      response_type: "code",
      redirect_uri: callbackUrl(request, env, options),
      scope: options.scope || "openid profile email",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      nonce,
    }).toString();
    return redirect(authorize, [cookie(names.state, stateValue, 600)]);
  }

  async function callback(request: Request, env: OAuthEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const value = cookies(request)[names.state] || "";
    const [state, verifier, nonce, encodedReturn] = value.split(".");
    if (!state || !constantTimeEqual(state, url.searchParams.get("state") || "") || !verifier) {
      if (options.getSession && await resolveUser(request, env)) {
        return redirect(url.origin, [clearCookie(names.state)]);
      }
      return authError("The sign-in state was invalid or expired.", 400);
    }

    const config = await configuration(env, options);
    const clientId = required(env, envName("clientId", "OIDC_CLIENT_ID"));
    const tokenResponse = await fetch(config.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: required(env, envName("clientSecret", "OIDC_CLIENT_SECRET")),
        grant_type: "authorization_code",
        code: url.searchParams.get("code") || "",
        redirect_uri: callbackUrl(request, env, options),
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) throw new Error("OIDC token exchange failed");
    const token = await tokenResponse.json();
    const idToken = token && typeof token === "object" && !Array.isArray(token)
      ? Reflect.get(token, "id_token")
      : undefined;
    const claims = await verifyIdToken(idToken, config, clientId, nonce);
    if (!claims.sub) return authError("The identity provider returned no subject.", 502);

    const candidate = options.onLogin
      ? await options.onLogin(claims, env)
      : normalizeUser(claims);
    const user = await resolveLoginUser({
      ...candidate,
      email_verified: claims.email_verified === true,
    }, env, request);
    const identity = sessionIdentity(user);
    const sessionSeconds = options.sessionSeconds || 28_800;
    const signed = options.createSession
      ? await options.createSession(identity, env, request)
      : await sign(JSON.stringify({ ...identity, exp: Math.floor(Date.now() / 1000) + sessionSeconds }), env, envName("sessionSecret", "AUTH_SESSION_SECRET"));
    await env.event?.("auth.login.succeeded", "auth", { userId: user.authUser?.id });
    return redirect(`${url.origin}${decodeReturn(encodedReturn)}`, [
      cookie(names.session, signed, sessionSeconds),
      clearCookie(names.state),
    ]);
  }

  const domain = new OAuthSingleDomain({
    login: ({ request, env }) => login(request, env),
    callback: ({ request, env }) => callback(request, env),
    logout: async ({ request, env }) => {
      const originResponse = checkOrigin(request, options.allowedOrigins);
      return originResponse || logout(request, env, names.session, options);
    },
    me: async ({ request, env, state }) =>
      secureJson({ user: publicUser(await resolveRequestUser(request, env, state)) }),
  });

  return {
    name: "auth",
    displayName: options.displayName || "Authentication",
    packageName: PACKAGE_NAME,
    version: VERSION,
    strategy: OAUTH_SINGLE,
    domains: [domain, ...(options.domains || [])],
    healthchecks: options.healthchecks || [],
    circuitBreakers: options.circuitBreakers || [],
    async handle(
      request: Request,
      env: OAuthEnvironment,
      _ctx?: ExecutionContext,
      state?: AuthRequestState,
    ): Promise<Response | null> {
      const url = new URL(request.url);
      if (
        !protectedPath(url.pathname)
        || publicPaths.some((path) => path === "/" ? url.pathname === "/" : url.pathname.startsWith(path))
      ) return null;

      if (isMutation(request)) {
        const originResponse = checkOrigin(request, options.allowedOrigins);
        if (originResponse) return originResponse;
      }
      const user = await resolveRequestUser(request, env, state);
      if (user && options.authorize && !(await options.authorize({ request, url, user, env }))) {
        return url.pathname.startsWith("/api/")
          ? Response.json(
            { error: "Administrator access is required." },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          )
          : authError("Administrator access is required.", 403);
      }
      if (user) return null;
      if (url.pathname.startsWith("/api/")) {
        return Response.json(
          { error: "Authentication is required." },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.redirect(
        `${url.origin}/auth/login?return_to=${encodeURIComponent(safeReturnTo(url.pathname + url.search))}`,
        302,
      );
    },
    getUser: (request: Request, env: OAuthEnvironment) => resolveUser(request, env),
    healthcheck: async (env: OAuthEnvironment) => ({
      feature: "auth",
      component: "configuration",
      displayName: "Authentication configuration",
      state: Boolean(env.DB) && [
        envName("discoveryUrl", "OIDC_DISCOVERY_URL"),
        envName("issuer", "OIDC_ISSUER"),
        envName("clientId", "OIDC_CLIENT_ID"),
        envName("clientSecret", "OIDC_CLIENT_SECRET"),
        envName("sessionSecret", "AUTH_SESSION_SECRET"),
      ].every((key) => env[key] && !String(env[key]).startsWith("replace-with-")) ? "green" : "red",
    }),
    middleware(
      request: Request,
      env: OAuthEnvironment,
      ctx: ExecutionContext,
      next: (request: Request, env?: OAuthEnvironment, ctx?: ExecutionContext, state?: AuthRequestState) => Response | Promise<Response>,
      state?: AuthRequestState,
    ): Promise<Response> {
      return this.handle(request, env, ctx, state)
        .then((response) => response || next(request, env, ctx, state));
    },
  };
}

function isMutation(request: Request): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
}

function checkOrigin(request: Request, allowedOrigins: readonly string[] = []): Response | null {
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return authError("This request did not pass the same-origin check.", 403);
  }
  return sameOrigin(request, [requestOrigin, ...allowedOrigins])
    ? null
    : authError("A same-origin request is required.", 403);
}

async function logout(
  request: Request,
  env: OAuthEnvironment,
  name: string,
  options: OAuthOptions,
): Promise<Response> {
  const token = cookies(request)[name];
  if (token && options.revokeSession) await options.revokeSession(token, env, request);
  await env.event?.("auth.logout", "auth");
  return redirect(new URL(request.url).origin + "/", [clearCookie(name)]);
}

function authError(message: string, status: number): Response {
  return secureText(message, status);
}
