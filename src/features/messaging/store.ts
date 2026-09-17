import type { DataActorContext, DataRow, DataScopeReader } from "../../data/model.js";
import { DataScopeError } from "../../data/resources.js";
import { conversation, message, normalizeContext, normalizedMessage, participant, participants } from "./models.js";
import type {
  Conversation,
  ConversationInput,
  Message,
  MessageInput,
  Participant,
  ParticipantInput,
} from "./models.js";

export interface MessagingStoreOptions {
  conversationsResource?: string;
  participantsResource?: string;
  messagesResource?: string;
}

export interface MessageListOptions {
  limit?: number;
}

export interface ConversationLoadOptions extends MessageListOptions {
  includeMessages?: boolean;
}

export interface ConversationListOptions extends ConversationLoadOptions {
  limit?: number;
}

export type HydratedConversation = Conversation & { messages?: Array<Message & { isGroup: boolean }> };

export interface MessagingStore {
  readonly tables: Readonly<{
    conversations: string;
    participants: string;
    messages: string;
  }>;
  findConversation(context: unknown, options?: ConversationLoadOptions): Promise<HydratedConversation | null>;
  findConversationById(id: unknown, options?: ConversationLoadOptions): Promise<HydratedConversation | null>;
  listConversations(options?: ConversationListOptions): Promise<HydratedConversation[]>;
  createConversation(input: ConversationInput): Promise<HydratedConversation | null>;
  getOrCreateConversation(input: ConversationInput): Promise<HydratedConversation | null>;
  addParticipants(conversationId: unknown, values: readonly ParticipantInput[]): Promise<void>;
  removeParticipant(conversationId: unknown, value: ParticipantInput): Promise<void>;
  updateConversation(conversationId: unknown, changes: Pick<ConversationInput, "title">): Promise<HydratedConversation | null>;
  deleteConversation(conversationId: unknown): Promise<void>;
  getMessages(conversationId: unknown, options?: MessageListOptions): Promise<Array<Message & { isGroup: boolean }>>;
  appendMessage(conversationId: unknown, input: MessageInput): Promise<Message & { isGroup: boolean }>;
  deleteMessage(conversationId: unknown, messageId: unknown): Promise<void>;
}

export function createMessagingStore(
  reader: DataScopeReader,
  options: MessagingStoreOptions = {},
): Readonly<MessagingStore> {
  if (!reader || typeof reader.list !== "function") throw new TypeError("A scoped data reader is required");
  const names = {
    conversations: options.conversationsResource || "messaging_conversations",
    participants: options.participantsResource || "messaging_conversation_participants",
    messages: options.messagesResource || "messaging_messages",
  };

  async function actor(): Promise<DataActorContext | null> {
    return typeof reader.context === "function" ? reader.context() : null;
  }

  function actorParticipant(context: DataActorContext): ParticipantInput | null {
    return context.userId
      ? { type: "user", key: context.userId, name: context.displayName || context.userId }
      : null;
  }

  function canAccess(value: HydratedConversation, context: DataActorContext | null): boolean {
    if (!context || context.system) return true;
    if (!context.userId) return false;
    return value.createdBy?.type === "user" && value.createdBy.key === context.userId
      || value.participants.some((item) => item.type === "user" && item.key === context.userId);
  }

  function canManage(value: HydratedConversation, context: DataActorContext | null): boolean {
    if (!context || context.system) return true;
    return Boolean(context.userId && value.createdBy?.type === "user" && value.createdBy.key === context.userId);
  }

  async function requireAccess(value: HydratedConversation | null, manage = false): Promise<HydratedConversation | null> {
    if (!value) return null;
    const context = await actor();
    if (!(manage ? canManage(value, context) : canAccess(value, context))) {
      throw new DataScopeError("Conversation access is not permitted");
    }
    return value;
  }

  async function participantsFor(conversationId: unknown): Promise<Participant[]> {
    return (await reader.list(names.participants, { where: { conversation_id: conversationId }, limit: 1000, orderBy: "id ASC" })).map(rowParticipant);
  }

  async function messagesFor(
    conversationId: unknown,
    options: MessageListOptions = {},
  ): Promise<Array<Message & { isGroup: boolean }>> {
    const thread = await hydrate(await reader.get(names.conversations, conversationId), { includeMessages: false });
    await requireAccess(thread);
    const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
    return (await reader.list(names.messages, { where: { conversation_id: conversationId }, limit, orderBy: "id DESC" })).reverse().map(rowMessage);
  }

  async function hydrate(
    row: DataRow | null | undefined,
    options: ConversationLoadOptions = {},
  ): Promise<HydratedConversation | null> {
    if (!row) return null;
    const value: HydratedConversation = conversation({
      id: row.id,
      context: row.context,
      title: row.title,
      createdBy: row.created_by_key ? { type: row.created_by_type, key: row.created_by_key, name: row.created_by_name } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      participants: [],
    });
    value.participants = await participantsFor(row.id);
    await requireAccess(value);
    if (options.includeMessages !== false) {
      const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
      value.messages = (await reader.list(names.messages, { where: { conversation_id: row.id }, limit, orderBy: "id DESC" })).reverse().map(rowMessage);
    }
    return value;
  }

  async function listConversations(options: ConversationListOptions = {}) {
    const limit = Math.max(1, Math.min(200, Number(options.limit || 50)));
    const rows = await reader.list(names.conversations, { limit: 1000, orderBy: "updated_at DESC" });
    const values = await Promise.all(rows.map(async (row) => {
      try { return await hydrate(row, options); } catch (error) {
        if (error instanceof DataScopeError) return null;
        throw error;
      }
    }));
    return values.filter((value): value is HydratedConversation => value !== null).slice(0, limit);
  }

  async function findConversation(context: unknown, options: ConversationLoadOptions = {}) {
    return hydrate((await reader.list(names.conversations, { where: { context: normalizeContext(context) }, limit: 1 }))[0], options);
  }

  async function findConversationById(id: unknown, options: ConversationLoadOptions = {}) {
    return hydrate(await reader.get(names.conversations, id), options);
  }

  async function addParticipants(
    conversationId: unknown,
    values: readonly ParticipantInput[],
  ): Promise<void> {
    await requireAccess(await hydrate(await reader.get(names.conversations, conversationId), { includeMessages: false }), true);
    for (const item of participants(values)) {
      const existing = (await reader.list(names.participants, { where: { conversation_id: conversationId, participant_type: item.type, participant_key: item.key }, limit: 1 }))[0];
      if (!existing) await reader.insert(names.participants, { conversation_id: conversationId, participant_type: item.type, participant_key: item.key, display_name: item.name, metadata_json: JSON.stringify(item.metadata) });
    }
  }

  async function createConversation(input: ConversationInput) {
    const context = await actor();
    const canonical = context && !context.system ? actorParticipant(context) : null;
    const value = conversation({
      ...input,
      ...(canonical ? { createdBy: canonical, participants: [...(input.participants || []), canonical] } : {}),
    });
    const createdBy = value.createdBy;
    const row = await reader.insert(names.conversations, { context: value.context, title: value.title, created_by_type: createdBy?.type || null, created_by_key: createdBy?.key || null, created_by_name: createdBy?.name || null });
    const created = row?.id ? row : (await reader.list(names.conversations, { where: { context: value.context }, limit: 1 }))[0];
    if (!created) throw new Error("conversation_create_failed");
    await addParticipants(created.id, value.participants);
    return hydrate(created, { includeMessages: false });
  }

  async function getOrCreateConversation(input: ConversationInput) {
    const existing = await findConversation(input.context, { includeMessages: false });
    if (existing) {
      await addParticipants(existing.id, input.participants || []);
      return findConversationById(existing.id, { includeMessages: false });
    }
    try { return await createConversation(input); } catch (error) {
      const raced = await findConversation(input.context, { includeMessages: false });
      if (raced) return raced;
      throw error;
    }
  }

  async function appendMessage(conversationId: unknown, input: MessageInput) {
    const thread = await findConversationById(conversationId, { includeMessages: false });
    if (!thread) throw new Error("conversation_not_found");
    await requireAccess(thread);
    const context = await actor();
    const canonical = context && !context.system ? actorParticipant(context) : null;
    const value = normalizedMessage({
      ...input,
      context: thread.context,
      ...(canonical ? { sender: canonical } : {}),
    }, thread.context);
    const row = await reader.insert(names.messages, { conversation_id: conversationId, context: value.context, sender_type: value.sender.type, sender_key: value.sender.key, sender_name: value.sender.name, body: value.body, message_type: value.messageType, response_type: value.responseType, audience_json: JSON.stringify(value.audience), metadata_json: JSON.stringify(value.metadata) });
    await reader.update(names.conversations, conversationId, { updated_at: new Date().toISOString() });
    return rowMessage(row);
  }

  async function updateConversation(conversationId: unknown, changes: Pick<ConversationInput, "title">) {
    const thread = await requireAccess(await hydrate(await reader.get(names.conversations, conversationId), { includeMessages: false }), true);
    if (!thread) throw new Error("conversation_not_found");
    const title = conversation({ context: thread.context, title: changes.title }).title;
    await reader.update(names.conversations, conversationId, { title, updated_at: new Date().toISOString() });
    return findConversationById(conversationId, { includeMessages: false });
  }

  async function removeParticipant(conversationId: unknown, value: ParticipantInput): Promise<void> {
    const thread = await requireAccess(await hydrate(await reader.get(names.conversations, conversationId), { includeMessages: false }), true);
    if (!thread) throw new Error("conversation_not_found");
    const item = participant(value);
    if (thread.createdBy?.type === item.type && thread.createdBy.key === item.key) {
      throw new DataScopeError("The conversation creator cannot be removed");
    }
    await reader.deleteWhere(names.participants, {
      conversation_id: conversationId,
      participant_type: item.type,
      participant_key: item.key,
    });
  }

  async function deleteConversation(conversationId: unknown): Promise<void> {
    const thread = await requireAccess(await hydrate(await reader.get(names.conversations, conversationId), { includeMessages: false }), true);
    if (!thread) throw new Error("conversation_not_found");
    await reader.delete(names.conversations, conversationId);
  }

  async function deleteMessage(conversationId: unknown, messageId: unknown): Promise<void> {
    const thread = await requireAccess(await hydrate(await reader.get(names.conversations, conversationId), { includeMessages: false }), true);
    if (!thread) throw new Error("conversation_not_found");
    await reader.deleteWhere(names.messages, { id: messageId, conversation_id: conversationId });
  }

  return Object.freeze({ tables: names, findConversation, findConversationById, listConversations, createConversation, getOrCreateConversation, addParticipants, removeParticipant, updateConversation, deleteConversation, getMessages: messagesFor, appendMessage, deleteMessage });
}

function rowParticipant(row: DataRow): Participant {
  return participant({ type: row.participant_type, key: row.participant_key, name: row.display_name, metadata: json(row.metadata_json, {}) });
}

function rowMessage(row: DataRow): Message & { isGroup: boolean } {
  const value = message({
    id: row.id,
    conversationId: row.conversation_id,
    context: row.context,
    sender: { type: row.sender_type, key: row.sender_key, name: row.sender_name },
    body: row.body,
    messageType: row.message_type,
    responseType: row.response_type,
    audience: json(row.audience_json, []),
    metadata: json(row.metadata_json, {}),
    createdAt: row.created_at,
  });
  return { ...value, isGroup: value.messageType === "group" || value.audience.length > 0 };
}

function json<Result>(value: unknown, fallback: Result): Result {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}
