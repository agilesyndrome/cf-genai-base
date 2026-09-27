import { AppDomain, type DomainHandler } from "../../domain/index.js";
import type { AuthRequestState, OAuthEnvironment } from "./model.js";

interface OAuthHandlers {
  login: DomainHandler<OAuthEnvironment, AuthRequestState>;
  callback: DomainHandler<OAuthEnvironment, AuthRequestState>;
  logout: DomainHandler<OAuthEnvironment, AuthRequestState>;
  me: DomainHandler<OAuthEnvironment, AuthRequestState>;
}

/** The domain owns only HTTP registration; protocol and session code live elsewhere. */
export class OAuthSingleDomain extends AppDomain<unknown, OAuthEnvironment, AuthRequestState> {
  constructor(handlers: OAuthHandlers) {
    super({ name: "auth.oauth-single", basePath: "/auth", auth: "user" });
    this.route({ method: "GET", path: "/login", auth: "public", handler: handlers.login });
    this.route({ method: "GET", path: "/callback", auth: "public", handler: handlers.callback });
    this.route({ method: "POST", path: "/logout", auth: "public", handler: handlers.logout });
    this.route({ method: "GET", absolutePath: "/api/me", auth: "public", handler: handlers.me });
  }
}
