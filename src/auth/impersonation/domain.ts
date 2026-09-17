import { AppDomain } from "../../domain/index.js";
import { jsonWithCookie } from "../../api/http.js";
import { IMPERSONATION_COOKIE } from "./constants.js";
export class AuthImpersonationDomain extends AppDomain {
  constructor() {
    super({ name: "auth.impersonation", basePath: "/api/admin/impersonate", auth: "user", scopes: "impersonation:start" });
    this.route({
      method: "POST",
      path: "/clear",
      csrf: true,
      handler: () =>
        jsonWithCookie(
          { ok: true },
          `${IMPERSONATION_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
        ),
    });
  }
}

export const authImpersonation = new AuthImpersonationDomain();
