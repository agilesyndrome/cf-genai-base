/** @jsxImportSource hono/jsx */

import type { FC } from "hono/jsx";
import type { AuthTenant } from "../model.js";

export const TenantListView: FC<{ tenants: readonly AuthTenant[]; title?: string }> = ({ tenants, title = "Tenants" }) => (
  <section>
    <h1>{title}</h1>
    {tenants.length ? <ul>{tenants.map((tenant) => <li key={tenant.id}><strong>{tenant.name}</strong><small>{tenant.id}</small></li>)}</ul> : <p>No tenants registered.</p>}
  </section>
);
