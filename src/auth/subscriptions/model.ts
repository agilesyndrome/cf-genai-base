export interface SubscriptionEntitlement {
  entitlement: string;
  value: unknown;
}

export interface Subscription {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  entitlements?: SubscriptionEntitlement[];
}

export interface SubscriptionManifestEntry {
  id: string;
  name: string;
  entitlements: Record<string, unknown>;
}

export interface SubscriptionServiceOptions {
  who?: string;
}
