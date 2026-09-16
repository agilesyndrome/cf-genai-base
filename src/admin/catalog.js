import { listFeatureCatalog } from "../core/circuits.js";
import { requestActor } from "../core/identity.js";

export async function featureCatalogPage(env, features, state) {
  const catalog = await listFeatureCatalog(env, features, { who: requestActor(state) });
  return new Response(featureCatalogMarkup(catalog), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function featureCatalogMarkup(catalog) {
  const rows = catalog.map((item) => {
    const checks = item.healthchecks.length ? "<ul>" + item.healthchecks.map((check) => "<li><strong>" + escapeHtml(check.display_name) + "</strong>: " + escapeHtml(check.state) + "</li>").join("") + "</ul>" : "<span>None registered</span>";
    const breakers = item.circuit_breakers.length ? "<ul>" + item.circuit_breakers.map((breaker) => "<li><strong>" + escapeHtml(breaker.display_name) + "</strong>: " + escapeHtml(breaker.state) + "</li>").join("") + "</ul>" : "<span>None registered</span>";
    const packageLabel = item.package_name ? escapeHtml(item.package_name) : "Unknown package";
    const versionLabel = item.version ? escapeHtml(item.version) : "Unknown version";
    return "<tr><td><strong>" + escapeHtml(item.display_name) + "</strong><br><code>" + escapeHtml(item.feature) + "</code></td><td>" + packageLabel + "<br>" + versionLabel + "</td><td><span class=\"state state-" + escapeHtml(item.health) + "\">" + escapeHtml(item.health) + "</span></td><td>" + (item.circuit_breaker ? escapeHtml(item.circuit_breaker.state) : "None") + "</td><td>" + checks + "</td><td>" + breakers + "</td></tr>";
  }).join("");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Features</title><style>body{font:15px/1.45 system-ui,sans-serif;color:#20231f;background:#f7f7f5;margin:0;padding:2rem}main{max-width:1200px;margin:auto;background:#fff;padding:1.5rem;border:1px solid #d8ddd5;border-radius:.6rem}nav{display:flex;gap:1rem;margin-bottom:1.5rem}a{color:#2f6f52}table{width:100%;border-collapse:collapse}th,td{padding:.7rem;border-bottom:1px solid #d8ddd5;text-align:left;vertical-align:top}th{font-size:.8rem;color:#687067;text-transform:uppercase}ul{margin:.25rem 0;padding-left:1.2rem}code{color:#687067}.state{font-weight:700}.state-green{color:#26734d}.state-yellow{color:#9a6b00}.state-red{color:#b3261e}</style></head><body><main><nav><a href=\"/admin\">Admin</a><a href=\"/admin/features\" aria-current=\"page\">Features</a><a href=\"/admin/users\">Users</a><a href=\"/admin/groups\">Groups</a></nav><h1>Installed features</h1><p>Runtime modules, package versions, healthchecks, and circuit breakers.</p><table><thead><tr><th>Feature</th><th>Package/version</th><th>Health</th><th>Roll-up breaker</th><th>Healthchecks</th><th>Circuit breakers</th></tr></thead><tbody>" + rows + "</tbody></table></main></body></html>";
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll(String.fromCharCode(39), "&#39;"); }
