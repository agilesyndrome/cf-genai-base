import { AppDomain } from "../../domain/index.js";
import { badRequest, errorMessage, notFound, readJsonObject, stringArrayField } from "../../api/http.js";
import { ensureSubscriptionManifest, getSubscription, listSubscriptions, listTenantSubscriptions, replaceTenantSubscriptions } from "./service.js";

import type { Subscription } from "./model.js";

/** Manifest-owned subscription catalog with administrator assignment routes. */
export class AuthSubscriptionsDomain extends AppDomain<Subscription> {
  readonly #manifest: readonly unknown[];

  constructor(manifest: readonly unknown[] = []) {
    super({ name: "auth.subscriptions", basePath: "/api/admin/subscriptions", auth: "user", scopes: "subscriptions:read" });
    this.#manifest = manifest;
    this.route({ method: "GET", handler: ({ env, identity }) => listSubscriptions(env, { who: identity.who }).then((subscriptions) => Response.json({ subscriptions })) });
    this.route({ method: "GET", path: "/:subscriptionId", handler: async ({ env, identity, params }) => {
      const subscription = await getSubscription(env, params.subscriptionId, { who: identity.who });
      return subscription ? Response.json({ subscription }) : notFound("Subscription not found.");
    } });
    this.route({ method: "GET", absolutePath: "/api/admin/tenants/:tenantId/subscriptions", handler: async ({ env, identity, params }) =>
      Response.json({ subscriptions: await listTenantSubscriptions(env, params.tenantId, { who: identity.who }) }) });
    this.route({ method: "PUT", absolutePath: "/api/admin/tenants/:tenantId/subscriptions", csrf: true, scopes: "subscriptions:manage", handler: async ({ request, env, identity, params }) => {
      try {
        const subscriptions = stringArrayField(await readJsonObject(request), "subscriptions");
        if (!subscriptions) return badRequest("subscriptions must be an array");
        return Response.json({ subscriptions: await replaceTenantSubscriptions(env, params.tenantId, subscriptions, { who: identity.who }) });
      } catch (error) {
        return badRequest(errorMessage(error));
      }
    } });
  }

  initialize(env: unknown): Promise<void> {
    return ensureSubscriptionManifest(env, [...this.#manifest], { who: "system:update" });
  }
}

export const authSubscriptions = new AuthSubscriptionsDomain();
