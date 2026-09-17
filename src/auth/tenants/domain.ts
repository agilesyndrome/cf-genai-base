import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import { badRequest, errorMessage, notFound, readJsonObject, stringField } from "../../api/http.js";
import type { AuthTenant, TenantAuthorizationState } from "./model.js";
import { createTenant, deleteTenant, getTenant, listTenants, listTenantUsers, updateTenant } from "./service.js";
import { TenantListView } from "./views/list.js";
type Context = DomainRequestContext<unknown, TenantAuthorizationState>;

/** Composes the tenant model, API policy, handlers, and server-rendered views. */
export class AuthTenantsDomain extends AppDomain<AuthTenant, unknown, TenantAuthorizationState> {
  constructor() {
    super({ name: "auth.tenants", basePath: "/api/admin/tenants", auth: "user", scopes: "tenants:read" });
    this.view("list", TenantListView);
    this.route({
      method: "GET",
      handler: ({ env, identity }) =>
        listTenants(env, { who: identity.who }).then((tenants) => Response.json({ tenants })),
    });
    this.route({ method: "POST", csrf: true, scopes: "tenants:manage", handler: create });
    this.route({ method: "GET", path: "/:tenantId", handler: get });
    this.route({ method: "GET", path: "/:tenantId/users", handler: ({ env, identity, params }) =>
      listTenantUsers(env, params.tenantId, { who: identity.who }).then((users) => Response.json({ users })) });
    this.route({ method: ["PUT", "PATCH"], path: "/:tenantId", csrf: true, scopes: "tenants:manage", handler: update });
    this.route({ method: "DELETE", path: "/:tenantId", csrf: true, scopes: "tenants:delete", handler: remove });
  }
}

async function create({ request, env, identity }: Context) {
  try {
    const tenant = await createTenant(env, await readJsonObject(request), { who: identity.who });
    return Response.json({ tenant }, { status: 201 });
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function get({ env, identity, params }: Context) {
  try {
    const tenant = await getTenant(env, params.tenantId, { who: identity.who });
    return tenant ? Response.json({ tenant }) : notFound("Tenant not found.");
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function update({ request, env, identity, params }: Context) {
  try {
    const name = stringField(await readJsonObject(request), "name");
    if (!name) return badRequest("name is required");
    const tenant = await updateTenant(env, params.tenantId, name, { who: identity.who });
    return tenant ? Response.json({ tenant }) : notFound("Tenant not found.");
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function remove({ request, env, identity, params }: Context) {
  try {
    if (request.headers.get("X-Confirm-Delete") !== params.tenantId) {
      return badRequest("X-Confirm-Delete must match the tenant id.");
    }
    const deleted = await deleteTenant(env, params.tenantId, { who: identity.who });
    return deleted ? new Response(null, { status: 204 }) : notFound("Tenant not found.");
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

export const authTenants = new AuthTenantsDomain();
