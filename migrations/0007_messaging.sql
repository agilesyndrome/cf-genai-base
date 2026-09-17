-- Shared storage for the opt-in cf-genai-base messaging feature.
CREATE TABLE IF NOT EXISTS messaging_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  context TEXT NOT NULL,
  title TEXT,
  created_by_type TEXT,
  created_by_key TEXT,
  created_by_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, context),
  UNIQUE(tenant_id, id),
  UNIQUE(tenant_id, id, context)
);

CREATE TABLE IF NOT EXISTS messaging_conversation_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL,
  participant_type TEXT NOT NULL,
  participant_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, conversation_id, participant_type, participant_key),
  FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES messaging_conversations(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messaging_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL,
  context TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_key TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  response_type TEXT,
  audience_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id, conversation_id, context)
    REFERENCES messaging_conversations(tenant_id, id, context) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messaging_conversations_context
  ON messaging_conversations(tenant_id, context);
CREATE INDEX IF NOT EXISTS idx_messaging_messages_thread
  ON messaging_messages(tenant_id, conversation_id, id);
