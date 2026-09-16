export function defineApp({ name, ui = true, api = true, admin = true, features = [], repositories = [] } = {}) {
  if (!/^[a-z][a-z0-9-]*$/.test(String(name || ""))) throw new TypeError("Apps require a safe name");
  if (!ui && !api) throw new TypeError("An app must expose ui or api");
  return { name: String(name), ui: Boolean(ui), api: Boolean(api), admin: Boolean(admin), features: [...features], repositories: [...repositories] };
}
