import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import type { IdentityState } from "../identity/index.js";
import type { D1Environment } from "../../core/database/index.js";
import {
  badRequest,
  errorMessage,
  jsonWithCookie,
  notFound,
  readJsonObject,
  stringArrayField,
} from "../../api/http.js";
import { IMPERSONATION_COOKIE } from "../impersonation/constants.js";
import { createImpersonationToken } from "../impersonation/service.js";
import { listUserGroups, replaceUserGroups } from "../groups/index.js";
import { listUserGrants, replaceUserGrants } from "../scopes/index.js";
import { listUserTenants, replaceUserTenants } from "../tenants/index.js";
import { AUTH_USER_REPOSITORY } from "../repositories.js";
import type { AuthUser } from "./model.js";
import { getAuthorizationUser, listAuthorizationUsers } from "./service.js";
import { replaceUserAccess } from "./access.js";

interface AuthUsersEnvironment extends D1Environment {
  AUTH_SESSION_SECRET?: string;
}
type Context = DomainRequestContext<AuthUsersEnvironment, IdentityState>;

export class AuthUsersDomain extends AppDomain<AuthUser, AuthUsersEnvironment, IdentityState> {
  constructor() {
    super({
      name: "auth.users",
      basePath: "/api/admin/users",
      auth: "user",
      scopes: "users:read",
      repositories: [AUTH_USER_REPOSITORY],
    });
    this.route({
      method: "GET",
      handler: ({ env, identity }) =>
        listAuthorizationUsers(env, { who: identity.who }).then((users) => Response.json({ users })),
    });
    this.route({
      method: "POST",
      path: "/:userId/impersonate",
      csrf: true,
      scopes: "impersonation:start",
      handler: impersonate,
    });
    this.route({ method: "GET", path: "/:userId", handler: getUser });
    this.route({ method: "PUT", path: "/:userId/access", csrf: true, scopes: "users:manage", handler: setAccess });
    for (const relation of ["groups", "tenants", "scopes"] as const) {
      this.route({
        method: "GET",
        path: `/:userId/${relation}`,
        handler: (context) => getRelation(relation, context),
      });
      this.route({
        method: "PUT",
        path: `/:userId/${relation}`,
        csrf: true,
        scopes: "users:manage",
        handler: (context) => setRelation(relation, context),
      });
    }
  }
}

async function setAccess({ request, env, identity, state, params }: Context): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    const groups = stringArrayField(body, "groups");
    const tenants = stringArrayField(body, "tenants");
    const scopes = stringArrayField(body, "scopes");
    if (!groups || !tenants || !scopes) return badRequest("groups, tenants, and scopes must be arrays");
    await replaceUserAccess(env, params.userId, { groups, tenants, scopes }, state.authUser?.id, { who: identity.who });
    return Response.json({ ok: true });
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function getUser({ env, identity, params }: Context): Promise<Response> {
  try {
    const user = await getAuthorizationUser(env, params.userId, { who: identity.who });
    if (!user) return notFound("User not found.");
    const options = { who: identity.who };
    const [groups, tenants, grants] = await Promise.all([
      listUserGroups(env, user.id, options),
      listUserTenants(env, user.id, options),
      listUserGrants(env, user.id, options),
    ]);
    return Response.json({ user: { ...user, groups, tenants, scopes: grants.map((grant) => grant.scope_name) } });
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function getRelation(
  relation: "groups" | "tenants" | "scopes",
  { env, identity, params }: Context,
): Promise<Response> {
  const options = { who: identity.who };
  if (relation === "groups") {
    return Response.json({ groups: await listUserGroups(env, params.userId, options) });
  }
  if (relation === "tenants") {
    return Response.json({ tenants: await listUserTenants(env, params.userId, options) });
  }
  return Response.json({ grants: await listUserGrants(env, params.userId, options) });
}

async function setRelation(
  relation: "groups" | "tenants" | "scopes",
  { request, env, identity, state, params }: Context,
): Promise<Response> {
  try {
    const values = stringArrayField(await readJsonObject(request), relation);
    if (!values) return badRequest(`${relation} must be an array`);
    const options = { who: identity.who };
    if (relation === "groups") {
      const groups = await replaceUserGroups(env, params.userId, values, state.authUser?.id, options);
      return Response.json({ groups });
    }
    if (relation === "tenants") {
      return Response.json({ tenants: await replaceUserTenants(env, params.userId, values, options) });
    }
    const grants = await replaceUserGrants(env, params.userId, values, state.authUser?.id, options);
    return Response.json({ grants });
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function impersonate({ env, identity, params }: Context): Promise<Response> {
  const target = await getAuthorizationUser(env, params.userId, { who: identity.who });
  if (!target) return notFound("User not found.");
  const token = await createImpersonationToken(
    env,
    identity.who.replace(/^user:/, ""),
    target.id,
  );
  return jsonWithCookie(
    {
      ok: true,
      user: { id: target.id, email: target.email, display_name: target.display_name },
      expires_in: 900,
    },
    `${IMPERSONATION_COOKIE}=${token}; Max-Age=900; Path=/; Secure; HttpOnly; SameSite=Lax`,
  );
}

export const authUsers = new AuthUsersDomain();
