import type { DataResourceInput } from "../../data/model.js";

export const MESSAGING_TABLES = Object.freeze({
  conversations: "messaging_conversations",
  participants: "messaging_conversation_participants",
  messages: "messaging_messages",
});

export const MESSAGING_DATA_RESOURCES: readonly DataResourceInput[] = Object.freeze([
  Object.freeze({ name: "messaging_conversations", table: MESSAGING_TABLES.conversations, scope: "tenant", columns: ["id", "tenant_id", "context", "title", "created_by_type", "created_by_key", "created_by_name", "created_at", "updated_at"], readableColumns: ["id", "tenant_id", "context", "title", "created_by_type", "created_by_key", "created_by_name", "created_at", "updated_at"], orderableColumns: ["id", "created_at", "updated_at"], writableColumns: ["context", "title", "created_by_type", "created_by_key", "created_by_name", "updated_at"] }),
  Object.freeze({ name: "messaging_conversation_participants", table: MESSAGING_TABLES.participants, scope: "tenant", columns: ["id", "tenant_id", "conversation_id", "participant_type", "participant_key", "display_name", "metadata_json", "created_at"], readableColumns: ["id", "tenant_id", "conversation_id", "participant_type", "participant_key", "display_name", "metadata_json", "created_at"], orderableColumns: ["id", "created_at"], writableColumns: ["conversation_id", "participant_type", "participant_key", "display_name", "metadata_json"] }),
  Object.freeze({ name: "messaging_messages", table: MESSAGING_TABLES.messages, scope: "tenant", columns: ["id", "tenant_id", "conversation_id", "context", "sender_type", "sender_key", "sender_name", "body", "message_type", "response_type", "audience_json", "metadata_json", "created_at"], readableColumns: ["id", "tenant_id", "conversation_id", "context", "sender_type", "sender_key", "sender_name", "body", "message_type", "response_type", "audience_json", "metadata_json", "created_at"], orderableColumns: ["id", "created_at"], writableColumns: ["conversation_id", "context", "sender_type", "sender_key", "sender_name", "body", "message_type", "response_type", "audience_json", "metadata_json"] }),
]);
