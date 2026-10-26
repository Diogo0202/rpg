/**
 * Campaign chat (MES-05): pure helpers for ordering, merging realtime rows and validating drafts.
 * Free of React and of the Supabase client so it runs under `node --test`.
 */

export const CHAT_MAX_LENGTH = 2000;
/** How many messages the panel keeps in memory (the database keeps up to 1000 per campaign). */
export const CHAT_PAGE_SIZE = 100;
export const CHAT_COLUMNS = "id,campaign_id,author_id,author_name,author_role,recipient_id,body,created_at,edited_at";

export type ChatRole = "narrador" | "jogador" | "convidado";
export type ChatSendStatus = "sending" | "failed";

export type ChatMessage = {
  id: string;
  campaign_id: string;
  author_id: string;
  author_name: string;
  author_role: ChatRole;
  recipient_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  /** Local-only state for optimistic sends; never comes from the database. */
  status?: ChatSendStatus;
};

export type ChatParticipant = { userId: string; name: string; role: ChatRole };

const ROLES: readonly ChatRole[] = ["narrador", "jogador", "convidado"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Validates an untrusted row (REST response or realtime payload). Returns null when malformed. */
export function parseChatMessage(raw: unknown): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!isUuid(row.id) || !isUuid(row.campaign_id) || !isUuid(row.author_id)) return null;
  if (typeof row.body !== "string" || typeof row.created_at !== "string" || Number.isNaN(Date.parse(row.created_at))) return null;
  const recipient = row.recipient_id == null ? null : isUuid(row.recipient_id) ? row.recipient_id : undefined;
  if (recipient === undefined) return null;
  const role = ROLES.includes(row.author_role as ChatRole) ? (row.author_role as ChatRole) : "convidado";
  const edited = typeof row.edited_at === "string" && !Number.isNaN(Date.parse(row.edited_at)) ? row.edited_at : null;
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    author_id: row.author_id,
    author_name: typeof row.author_name === "string" ? row.author_name.slice(0, 80) : "",
    author_role: role,
    recipient_id: recipient,
    body: row.body.slice(0, CHAT_MAX_LENGTH),
    created_at: row.created_at,
    edited_at: edited,
  };
}

/** Oldest first; ties broken by id so every client renders the same order. */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  const timeA = Date.parse(a.created_at);
  const timeB = Date.parse(b.created_at);
  if (timeA !== timeB) return timeA - timeB;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort(compareMessages);
}

/** Server copy wins over an optimistic one; between server copies the latest edit wins. */
function preferIncoming(existing: ChatMessage, incoming: ChatMessage): boolean {
  if (existing.status && !incoming.status) return true;
  if (!existing.status && incoming.status) return false;
  const editedA = existing.edited_at ? Date.parse(existing.edited_at) : 0;
  const editedB = incoming.edited_at ? Date.parse(incoming.edited_at) : 0;
  return editedB >= editedA;
}

/**
 * Merges incoming messages (snapshot or realtime) into the list: dedupes by id, keeps chronological
 * order and only the newest `limit` entries. Pending/failed local messages are never trimmed away.
 */
export function mergeMessages(existing: readonly ChatMessage[], incoming: readonly ChatMessage[], limit = CHAT_PAGE_SIZE): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) {
    const current = byId.get(message.id);
    if (!current || preferIncoming(current, message)) byId.set(message.id, message);
  }
  const sorted = sortMessages([...byId.values()]);
  const confirmed = sorted.filter((message) => !message.status);
  const overflow = Math.max(0, confirmed.length - Math.max(0, limit));
  if (!overflow) return sorted;
  const dropped = new Set(confirmed.slice(0, overflow).map((message) => message.id));
  return sorted.filter((message) => !dropped.has(message.id));
}

/** Replaces the confirmed messages with a fresh snapshot while keeping local pending/failed ones. */
export function resyncMessages(existing: readonly ChatMessage[], snapshot: readonly ChatMessage[], limit = CHAT_PAGE_SIZE): ChatMessage[] {
  const snapshotIds = new Set(snapshot.map((message) => message.id));
  const local = existing.filter((message) => message.status && !snapshotIds.has(message.id));
  return mergeMessages(local, snapshot, limit);
}

export type ChatChange =
  | { eventType: "INSERT" | "UPDATE"; new: unknown }
  | { eventType: "DELETE"; old: { id?: unknown } | null | undefined };

/** Applies a postgres_changes payload; rows from another campaign or malformed rows are ignored. */
export function applyChatChange(messages: readonly ChatMessage[], change: ChatChange, campaignId: string, limit = CHAT_PAGE_SIZE): ChatMessage[] {
  if (change.eventType === "DELETE") {
    const id = change.old?.id;
    return typeof id === "string" ? messages.filter((message) => message.id !== id) : [...messages];
  }
  const parsed = parseChatMessage(change.new);
  if (!parsed || parsed.campaign_id !== campaignId) return [...messages];
  return mergeMessages(messages, [parsed], limit);
}

export function removeMessage(messages: readonly ChatMessage[], id: string): ChatMessage[] {
  return messages.filter((message) => message.id !== id);
}

export function setMessageStatus(messages: readonly ChatMessage[], id: string, status: ChatSendStatus | undefined): ChatMessage[] {
  return messages.map((message) => message.id === id ? { ...message, status } : message);
}

export type DraftValidation = { ok: true; body: string } | { ok: false; error: string };

/** Mirrors the database check: 1..2000 characters after trimming; control characters removed. */
export function validateChatDraft(draft: string): DraftValidation {
  // Keep tabs and new lines; drop other control characters that only confuse rendering.
  const cleaned = draft.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\r\n?/g, "\n");
  const body = cleaned.trim();
  if (!body) return { ok: false, error: "Escreva uma mensagem antes de enviar." };
  if (body.length > CHAT_MAX_LENGTH) return { ok: false, error: `A mensagem passou de ${CHAT_MAX_LENGTH} caracteres.` };
  return { ok: true, body };
}

/**
 * Who may receive a private message from the viewer: players write only to narrators and narrators
 * whisper to anyone else. Mirrors the database trigger.
 */
export function privateRecipients(participants: readonly ChatParticipant[], viewerId: string): ChatParticipant[] {
  const viewer = participants.find((participant) => participant.userId === viewerId);
  if (!viewer) return [];
  return participants
    .filter((participant) => participant.userId !== viewerId && (viewer.role === "narrador" || participant.role === "narrador"))
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.name.localeCompare(b.name, "pt-BR"));
}

export type MessageVisibility = "public" | "private-sent" | "private-received";

export function messageVisibility(message: ChatMessage, viewerId: string): MessageVisibility {
  if (!message.recipient_id) return "public";
  return message.author_id === viewerId ? "private-sent" : "private-received";
}

export function canDeleteMessage(message: ChatMessage, viewerId: string, canManage: boolean): boolean {
  if (message.status) return message.status === "failed" && message.author_id === viewerId;
  return message.author_id === viewerId || canManage;
}

export const CHAT_ROLE_LABELS: Record<ChatRole, string> = { narrador: "Narrador", jogador: "Jogador", convidado: "Convidado" };

export function authorLabel(message: ChatMessage, viewerId: string): string {
  if (message.author_id === viewerId) return "Você";
  return message.author_name.trim() || "Membro da campanha";
}

/** Maps PostgREST/Postgres errors to a message for the player. */
export function chatErrorMessage(error: { code?: unknown; message?: unknown } | null | undefined): string {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "P0429") return "Você enviou mensagens demais em pouco tempo. Aguarde um minuto.";
  if (code === "42501") return "Você não tem permissão para esta ação no chat.";
  if (code === "23514") return "Mensagem inválida ou destinatário não permitido.";
  if (code === "23505") return "Esta mensagem já foi enviada.";
  return "Não foi possível falar com o servidor. Tente de novo.";
}

/** Topic for the postgres_changes channel of one campaign's chat. */
export function chatTopic(campaignId: string): string {
  return `campaign-chat-${campaignId}`;
}
