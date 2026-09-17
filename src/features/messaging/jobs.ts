import { executeJob } from "../../core/jobs/index.js";
import type { Job, JobOptions } from "../../core/jobs/model.js";
import type { Conversation, Message, MessageInput, ParticipantInput } from "./models.js";

export interface MessagingReplyStore {
  findConversationById(id: unknown): Promise<(Conversation & { messages?: Message[] }) | null>;
  appendMessage(conversationId: unknown, input: MessageInput): Promise<Message>;
}

export interface ReplyGenerationContext {
  conversation: Conversation & { messages?: Message[] };
  messages: Message[];
  job: Job;
  report(progress: unknown): Promise<Job | null>;
}

export interface ReplyJobDefinition {
  store?: MessagingReplyStore;
  conversationId?: unknown;
  sender?: ParticipantInput;
  messageType?: unknown;
  responseType?: unknown;
  audience?: readonly ParticipantInput[];
  metadata?: Record<string, unknown>;
  generate?: (context: ReplyGenerationContext) => MessageInput | Promise<MessageInput>;
}

export interface ReplyJobResult {
  conversationId: string;
  messageId: string;
}

export interface ReplyJobOptions extends JobOptions {
  toJobResult?: (reply: Message) => unknown | Promise<unknown>;
}

export async function executeReplyJob(
  env: unknown,
  jobId: unknown,
  definition: ReplyJobDefinition = {},
  options: ReplyJobOptions = {},
) {
  const store = definition.store;
  if (!store || typeof store.findConversationById !== "function" || typeof store.appendMessage !== "function") throw new TypeError("executeReplyJob requires a messaging store");
  if (typeof definition.generate !== "function") throw new TypeError("executeReplyJob requires a generate callback");
  const generate = definition.generate;
  const conversationId = definition.conversationId;
  if (conversationId === undefined || conversationId === null) throw new TypeError("conversationId is required");
  return executeJob<Message, unknown>(env, jobId, async ({ job, report }) => {
    await report({ phase: "loading_conversation" });
    const thread = await store.findConversationById(conversationId);
    if (!thread) throw new Error("conversation_not_found");
    await report({ phase: "generating_reply" });
    const reply = await generate({ conversation: thread, messages: thread.messages || [], job, report });
    if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
      throw new TypeError("Reply generator must return a message object");
    }
    await report({ phase: "saving_reply" });
    return store.appendMessage(conversationId, {
      ...reply,
      sender: reply.sender || definition.sender,
      messageType: reply.messageType || definition.messageType || "assistant",
      responseType: reply.responseType || definition.responseType,
      audience: reply.audience || definition.audience,
      metadata: { ...(definition.metadata || {}), ...(reply.metadata || {}) },
    });
  }, {
    who: options.who || "system:update",
    ctx: options.ctx,
    toJobResult: options.toJobResult || ((reply): ReplyJobResult => ({
      conversationId: String(conversationId),
      messageId: String(reply.id),
    })),
  });
}
