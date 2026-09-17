import type { AnyAppDomain } from "../../app.js";
import type { AuthUser } from "../users/model.js";

export interface OAuthEnvironment {
  DB?: D1Database;
  event?: (what: string, where: string, details?: Record<string, unknown>) => unknown;
  [key: string]: unknown;
}

export interface OAuthClaims {
  sub?: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
  iss?: string;
  aud?: string | string[];
  azp?: string;
  exp?: number;
  nonce?: string;
  [key: string]: unknown;
}

export interface OAuthIdentity {
  sub: string;
  email?: string;
  name?: string;
  email_verified?: boolean;
  auth_strategy?: string;
  exp?: number;
  authUser?: AuthUser | null;
  [key: string]: unknown;
}

export interface OAuthOptions {
  cookiePrefix?: string;
  stateCookieName?: string;
  sessionCookieName?: string;
  publicPaths?: readonly string[];
  protectedPath?: (pathname: string) => boolean;
  allowedOrigins?: readonly string[];
  displayName?: string;
  env?: Record<string, string>;
  scope?: string;
  sessionSeconds?: number;
  domains?: readonly AnyAppDomain[];
  healthchecks?: readonly unknown[];
  circuitBreakers?: readonly unknown[];
  authorize?: (context: { request: Request; url: URL; user: OAuthIdentity; env: OAuthEnvironment }) => boolean | Promise<boolean>;
  sessionAuthorize?: (context: { user: OAuthIdentity; request: Request; env: OAuthEnvironment }) => boolean | Promise<boolean>;
  loginAuthorize?: (context: { user: OAuthIdentity; request: Request; env: OAuthEnvironment }) => boolean | Promise<boolean>;
  onLogin?: (claims: OAuthClaims, env: OAuthEnvironment) => OAuthIdentity | Promise<OAuthIdentity>;
  createSession?: (identity: OAuthIdentity, env: OAuthEnvironment, request: Request) => string | Promise<string>;
  getSession?: (token: string, env: OAuthEnvironment, request: Request) => OAuthIdentity | null | Promise<OAuthIdentity | null>;
  revokeSession?: (token: string, env: OAuthEnvironment, request: Request) => unknown;
}

export interface OidcConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface AuthRequestState {
  user?: OAuthIdentity | null;
  [key: string]: unknown;
}
