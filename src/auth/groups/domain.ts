import { AppDomain, type DomainRequestContext } from "../../domain/index.js";
import {
  badRequest,
  errorMessage,
  notFound,
  readJsonObject,
} from "../../api/http.js";
import type { AuthGroup, GroupAuthorizationState } from "./model.js";
import {
  createGroup,
  deleteGroup,
  getGroup,
  listGroupUsers,
  listGroups,
  updateGroup,
} from "./service.js";
import { GroupListView } from "./views/list.js";
import { AUTH_GROUP_REPOSITORY } from "../repositories.js";

type Context = DomainRequestContext<unknown, GroupAuthorizationState>;

/** The complete auth.groups capability, suitable for core or downstream app manifests. */
export class AuthGroupsDomain extends AppDomain<
  AuthGroup,
  unknown,
  GroupAuthorizationState
> {
  constructor() {
    super({
      name: "auth.groups",
      basePath: "/api/admin/groups",
      auth: "user",
      scopes: "groups:read",
      repositories: [AUTH_GROUP_REPOSITORY],
    });
    this.view("list", GroupListView);
    this.route({
      method: "GET",
      handler: ({ env, identity }) =>
        listGroups(env, { who: identity.who }).then((groups) => Response.json({ groups })),
    });
    this.route({ method: "POST", csrf: true, scopes: "groups:manage", handler: create });
    this.route({ method: "GET", path: "/:groupName", handler: get });
    this.route({
      method: ["PUT", "PATCH"],
      path: "/:groupName",
      csrf: true,
      scopes: "groups:manage",
      handler: update,
    });
    this.route({ method: "DELETE", path: "/:groupName", csrf: true, scopes: "groups:manage", handler: remove });
    this.route({
      method: "GET",
      path: "/:groupName/users",
      handler: ({ env, identity, params }) =>
        listGroupUsers(env, params.groupName, { who: identity.who }).then((users) =>
          Response.json({ users }),
        ),
    });
  }
}

async function create({ request, env, identity }: Context): Promise<Response> {
  try {
    const group = await createGroup(env, await readJsonObject(request), { who: identity.who });
    return Response.json({ group }, { status: 201 });
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function get({ env, identity, params }: Context): Promise<Response> {
  try {
    const group = await getGroup(env, params.groupName, { who: identity.who });
    return group ? Response.json({ group }) : notFound("Group not found.");
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function update({ request, env, identity, params }: Context): Promise<Response> {
  try {
    const body = await readJsonObject(request);
    if (request.method === "PATCH") {
      const current = await getGroup(env, params.groupName, { who: identity.who });
      if (!current) return notFound("Group not found.");
      const group = await updateGroup(env, params.groupName, {
        display_name: body?.display_name ?? current.display_name,
        description: body?.description ?? current.description,
      }, { who: identity.who });
      return Response.json({ group });
    }
    const group = await updateGroup(
      env,
      params.groupName,
      body,
      { who: identity.who },
    );
    return group ? Response.json({ group }) : notFound("Group not found.");
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

async function remove({ env, identity, params }: Context): Promise<Response> {
  try {
    const deleted = await deleteGroup(env, params.groupName, { who: identity.who });
    return deleted ? new Response(null, { status: 204 }) : notFound("Group not found.");
  } catch (error) {
    return badRequest(errorMessage(error));
  }
}

export const authGroups = new AuthGroupsDomain();
