import { createD1 } from "../../core/database/index.js";
import { DEFAULT_TENANT_ID } from "../constants.js";
import type { TenantDatabaseOptions } from "./d1.js";

export async function deleteTenantRow(env: unknown, tenantId: string, { who = "system:update" }: TenantDatabaseOptions = {}): Promise<boolean> {
  if (tenantId === DEFAULT_TENANT_ID) throw new TypeError("The default tenant cannot be deleted.");
  const db = createD1(env, { who });
  const existing = await db.prepare("SELECT id FROM auth_tenants WHERE id=?").bind(tenantId).first();
  if (!existing) return false;
  const dependencies = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM auth_user_tenants WHERE tenant_id=?) AS users,
      (SELECT COUNT(*) FROM auth_tenant_subscriptions WHERE tenant_id=?) AS subscriptions
  `).bind(tenantId, tenantId).first<{ users: number; subscriptions: number }>();
  if (Number(dependencies?.users || 0) || Number(dependencies?.subscriptions || 0)) {
    throw new TypeError("Tenant must have no users or subscriptions before it can be deleted.");
  }
  const messagingTable = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messaging_conversations'").first();
  if (messagingTable) {
    const conversations = await db.prepare("SELECT COUNT(*) AS count FROM messaging_conversations WHERE tenant_id=?").bind(tenantId).first<{ count: number }>();
    if (Number(conversations?.count || 0)) {
      throw new TypeError("Tenant must have no conversations before it can be deleted.");
    }
  }
  await db.prepare("DELETE FROM auth_tenants WHERE id=?").bind(tenantId).run();
  return true;
}
