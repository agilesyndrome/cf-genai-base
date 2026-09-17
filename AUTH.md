# `@easleyowl/cf-genai-auth`

Shared Cloudflare Worker OIDC authentication. It provides `/auth/login`,
`/auth/callback`, `/auth/logout`, and `/api/me`, protects API/browser routes,
uses Authorization Code + PKCE, verifies RS256 ID tokens against the provider's
JWKS, and stores only a short-lived signed session cookie in the browser.

Required Worker vars/secrets are `OIDC_DISCOVERY_URL`, `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, and `AUTH_SESSION_SECRET`. The discovery document supplies
the provider configuration; `OIDC_ISSUER` is also required and pins the issuer
used for token validation. `OIDC_DISCOVERY_URL` must be the exact HTTPS
discovery document URL. Override names with
`createAuth({ env: { issuer, clientId, clientSecret, sessionSecret } })`.

```js
const auth = createAuth({ publicPaths: ["/", "/api/public/"] });
export default createWorker({
  app: defineApp({ name: "example", features: [auth] }),
  fetch: router,
});
```

The standard cookie is host-only and `Secure`; use a distinct `cookiePrefix`
when multiple environments share a browser. Authorization policy remains an
application concern. Version 5 always persists authenticated identities through
cf-genai-base and requires its `DB` binding:

```js
const auth = createAuth();
```

`getUser` returns the normalized identity plus `authUser`,
the `auth_users` record maintained by cf-genai-base. This keeps site code from
reimplementing user lookups and lets base authorization reuse the hydrated row.
The platform `auth.users` and `auth.groups` domains own their repositories.
Applications consume them through the request environment instead of
registering parallel auth repository definitions.

Built-in administrative domains use route capabilities so operators need not
all be platform administrators. Assign only the required `users:read`,
`users:manage`, `groups:read`, `groups:manage`, `tenants:read`,
`tenants:manage`, `tenants:delete`, `operations:read`, `operations:manage`,
`subscriptions:read`, `subscriptions:manage`, or `impersonation:start`
capabilities. Manifest scopes marked `system` cannot be granted directly
through the user administration API.

## Authorization

Pass `authorize({ request, url, user, env })` to `createAuth` when a site needs
role or route-level access control. Return `true` to continue or `false` for a
403 response. Keep the policy in the site initializer; the library does not
assume how roles are stored.

Use `loginAuthorize({ user, request, env })` for a policy that must run after a
new identity has been persisted. This is useful for application circuit
breakers or enrollment rules. Throw an auth error to reject the login or return
`false` to receive the standard 403 response.

Use `sessionAuthorize({ user, request, env })` to re-check an existing session
on each request. Returning `false` makes the session anonymous for that request;
this is useful for shared feature availability or emergency access policies.
