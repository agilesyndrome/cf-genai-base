export const AUTH_USER_REPOSITORY = {
  name: "users",
  resource: "auth_users",
  scope: "system",
  resourceDefinition: {
    name: "auth_users",
    table: "auth_users",
    scope: "system",
    columns: ["id", "provider", "subject", "email", "display_name", "is_admin", "created_at", "updated_at"],
    readableColumns: ["id", "provider", "subject", "email", "display_name", "is_admin", "created_at", "updated_at"],
    orderableColumns: ["id", "email", "created_at"],
    writableColumns: ["display_name", "is_admin"],
  },
} as const;

export const AUTH_GROUP_REPOSITORY = {
  name: "groups",
  resource: "auth_groups",
  scope: "system",
  resourceDefinition: {
    name: "auth_groups",
    table: "auth_groups",
    scope: "system",
    columns: ["name", "display_name", "description", "created_at", "updated_at"],
    idColumn: "name",
    readableColumns: ["name", "display_name", "description", "created_at", "updated_at"],
    orderableColumns: ["name", "created_at"],
    writableColumns: ["name", "display_name", "description"],
  },
} as const;

export const authRepositoryDefinitions = [AUTH_USER_REPOSITORY, AUTH_GROUP_REPOSITORY] as const;
