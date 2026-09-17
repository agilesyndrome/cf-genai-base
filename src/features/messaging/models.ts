export interface ParticipantInput {
  type?: unknown;
  key?: unknown;
  name?: unknown;
  metadata?: unknown;
}

export interface Participant {
  type: string;
  key: string;
  name: string;
  metadata: Record<string, unknown>;
}

export interface ConversationInput {
  id?: unknown;
  context?: unknown;
  title?: unknown;
  createdBy?: ParticipantInput | null;
  participants?: readonly ParticipantInput[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Conversation {
  id: string | number | null;
  context: string;
  title: string | null;
  createdBy: Participant | null;
  participants: Participant[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface MessageInput {
  id?: unknown;
  conversationId?: unknown;
  context?: unknown;
  sender?: ParticipantInput;
  body?: unknown;
  messageType?: unknown;
  responseType?: unknown;
  audience?: readonly ParticipantInput[];
  metadata?: unknown;
  createdAt?: unknown;
  isGroup?: boolean;
}

export interface Message {
  id: string | number | null;
  conversationId: string | number | null;
  context: string | null;
  sender: Participant;
  body: string;
  messageType: string;
  responseType: string | null;
  audience: Participant[];
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

export function normalizeContext(value: unknown): string {
  return text(value, "context", { required: true, max: 4096 });
}

export function participant(input: ParticipantInput = {}): Participant {
  assertKeys(input, ["type", "key", "name", "metadata"], "participant");
  return {
    type: text(input.type, "participant.type", { required: true, max: 80 }),
    key: text(input.key, "participant.key", { required: true, max: 256 }),
    name: text(input.name, "participant.name", { required: true, max: 256 }),
    metadata: object(input.metadata, "participant.metadata"),
  };
}

export function participants(values: readonly ParticipantInput[] = []): Participant[] {
  if (!Array.isArray(values)) throw new TypeError("participants must be an array");
  const seen = new Set<string>();
  return values.map(participant).filter((value) => {
    const key = value.type + ":" + value.key;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function conversation(input: ConversationInput = {}): Conversation {
  const source = input || {};
  assertKeys(source, ["id", "context", "title", "createdBy", "participants", "createdAt", "updatedAt"], "conversation");
  return {
    id: identifier(source.id),
    context: normalizeContext(source.context),
    title: text(source.title, "title", { max: 256 }),
    createdBy: source.createdBy ? participant(source.createdBy) : null,
    participants: participants(source.participants || []),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
  };
}

export function message(input: MessageInput = {}): Message {
  return normalizedMessage(input);
}

export function groupMessage(input: MessageInput = {}): Message & { isGroup: true } {
  const value = normalizedMessage({ ...input, messageType: input.messageType || "group" });
  return { ...value, isGroup: true };
}

export function normalizedMessage(
  input: MessageInput = {},
  defaultContext: unknown | null = null,
): Message {
  const source = input || {};
  assertKeys(source, ["id", "conversationId", "context", "sender", "body", "messageType", "responseType", "audience", "metadata", "createdAt", "isGroup"], "message");
  const context = source.context === undefined || source.context === null
    ? (defaultContext === null ? null : normalizeContext(defaultContext))
    : normalizeContext(source.context);
  return {
    id: identifier(source.id),
    conversationId: identifier(source.conversationId),
    context,
    sender: participant(source.sender),
    body: text(source.body, "body", { required: true, max: 16000 }),
    messageType: text(source.messageType || "text", "messageType", { required: true, max: 80 }),
    responseType: text(source.responseType, "responseType", { max: 80 }),
    audience: participants(source.audience || []),
    metadata: object(source.metadata, "metadata"),
    createdAt: timestamp(source.createdAt),
  };
}

function text(value: unknown, field: string, options: { required: true; max?: number }): string;
function text(value: unknown, field: string, options?: { required?: false; max?: number }): string | null;
function text(
  value: unknown,
  field: string,
  { required = false, max = 2048 }: { required?: boolean; max?: number } = {},
): string | null {
  if (value === undefined || value === null) {
    if (required) throw new TypeError(field + " is required");
    return null;
  }
  const result = String(value).trim();
  if (required && !result) throw new TypeError(field + " is required");
  if (result.length > max) throw new RangeError(field + " is too long");
  return result || null;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(field + " must be an object");
  return { ...value };
}

function identifier(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function timestamp(value: unknown): string | null {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function assertKeys(
  value: unknown,
  allowed: readonly string[],
  field: string,
): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(field + " must be an object");
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new TypeError(`${field} has unsupported fields: ${unexpected.join(", ")}`);
}
