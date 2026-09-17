import { AppDomain } from "../../domain/index.js";
import type { AuthScope, ScopeAuthorizationState } from "./model.js";
import { getAuthorizationScope, listAuthorizationScopes, validateScopeName } from "./service.js";
import { badRequest, notFound } from "../../api/http.js";
import { ScopeListView } from "./views/list.js";
export class AuthScopesDomain extends AppDomain<AuthScope, unknown, ScopeAuthorizationState> {
  constructor() {
    super({ name: "auth.scopes", basePath: "/api/admin/scopes", auth: "user", scopes: "scopes:read" });
    this.view("list", ScopeListView);
    this.route({
      method: "GET",
      handler: ({ env, identity }) =>
        listAuthorizationScopes(env, { who: identity.who }).then((scopes) =>
          Response.json({ scopes }),
        ),
    });
    this.route({ method: "GET", path: "/:scopeName", handler: async ({ env, identity, params }) => {
      try {
        const scope = await getAuthorizationScope(env, validateScopeName(params.scopeName), { who: identity.who });
        return scope ? Response.json({ scope }) : notFound("Scope not found.");
      } catch (error) {
        return badRequest(error instanceof Error ? error.message : "Invalid scope name");
      }
    } });
  }
}

export const authScopes = new AuthScopesDomain();
