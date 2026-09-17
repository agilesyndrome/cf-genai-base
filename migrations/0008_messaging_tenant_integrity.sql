-- Backstop existing databases created before messaging used composite foreign keys.
CREATE TRIGGER IF NOT EXISTS messaging_participants_tenant_insert
BEFORE INSERT ON messaging_conversation_participants
WHEN NOT EXISTS (
  SELECT 1 FROM messaging_conversations
  WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'conversation tenant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS messaging_participants_tenant_update
BEFORE UPDATE OF tenant_id, conversation_id ON messaging_conversation_participants
WHEN NOT EXISTS (
  SELECT 1 FROM messaging_conversations
  WHERE id=NEW.conversation_id AND tenant_id=NEW.tenant_id
)
BEGIN
  SELECT RAISE(ABORT, 'conversation tenant mismatch');
END;

CREATE TRIGGER IF NOT EXISTS messaging_messages_context_insert
BEFORE INSERT ON messaging_messages
WHEN NOT EXISTS (
  SELECT 1 FROM messaging_conversations
  WHERE id=NEW.conversation_id
    AND tenant_id=NEW.tenant_id
    AND context=NEW.context
)
BEGIN
  SELECT RAISE(ABORT, 'conversation tenant or context mismatch');
END;

CREATE TRIGGER IF NOT EXISTS messaging_messages_context_update
BEFORE UPDATE OF tenant_id, conversation_id, context ON messaging_messages
WHEN NOT EXISTS (
  SELECT 1 FROM messaging_conversations
  WHERE id=NEW.conversation_id
    AND tenant_id=NEW.tenant_id
    AND context=NEW.context
)
BEGIN
  SELECT RAISE(ABORT, 'conversation tenant or context mismatch');
END;
