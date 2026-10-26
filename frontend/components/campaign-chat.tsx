"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import {
  applyChatChange, authorLabel, canDeleteMessage, CHAT_COLUMNS, CHAT_MAX_LENGTH, CHAT_PAGE_SIZE, CHAT_ROLE_LABELS, chatErrorMessage, chatTopic,
  mergeMessages, messageVisibility, parseChatMessage, privateRecipients, removeMessage, resyncMessages, setMessageStatus, validateChatDraft,
  type ChatChange, type ChatMessage, type ChatParticipant, type ChatRole,
} from "../lib/campaign-chat";
import { connectionLabel, startRealtimeSync, type RealtimeConnection } from "../lib/realtime-sync";
import { createClient } from "../lib/supabase/client";
import styles from "./campaign-chat.module.css";

type ParticipantRow = { user_id: string; display_name: string | null; role: string | null };

function toParticipant(row: ParticipantRow): ChatParticipant | null {
  if (typeof row?.user_id !== "string") return null;
  const role: ChatRole = row.role === "narrador" || row.role === "jogador" ? row.role : "convidado";
  return { userId: row.user_id, name: (row.display_name ?? "").trim().slice(0, 80) || "Membro da campanha", role };
}

function timeLabel(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Campaign chat (MES-05): public table talk, player→narrator notes and narrator whispers. */
export function CampaignChat({ campaignId, viewerId, canManage }: { campaignId: string; viewerId: string; canManage: boolean }) {
  const uid = useId();
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [participants, setParticipants] = useState<ChatParticipant[]>([]);
  const [status, setStatus] = useState<RealtimeConnection>("connecting");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [recipient, setRecipient] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const syncRef = useRef<{ reconnectNow(): void } | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const stickRef = useRef(true);
  const requestRef = useRef(0);

  const setMessages = useCallback((update: (rows: ChatMessage[]) => ChatMessage[]) => {
    messagesRef.current = update(messagesRef.current);
    setMessagesState(messagesRef.current);
  }, []);

  const loadMessages = useCallback(async () => {
    const requestCampaign = campaignRef.current;
    const request = ++requestRef.current;
    try {
      const { data, error } = await createClient().from("campaign_chat_messages").select(CHAT_COLUMNS)
        .eq("campaign_id", requestCampaign).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(CHAT_PAGE_SIZE);
      if (campaignRef.current !== requestCampaign || request !== requestRef.current) return;
      if (error) throw error;
      const snapshot = ((data ?? []) as unknown[]).map(parseChatMessage).filter((row): row is ChatMessage => row !== null && row.campaign_id === requestCampaign);
      setMessages((rows) => resyncMessages(rows, snapshot));
    } catch (error) {
      if (campaignRef.current === requestCampaign) setNotice(chatErrorMessage(error as { code?: unknown }));
    } finally {
      if (campaignRef.current === requestCampaign) setLoading(false);
    }
  }, [setMessages]);

  useEffect(() => {
    let active = true;
    messagesRef.current = []; setMessagesState([]); setParticipants([]); setRecipient(""); setNotice(""); setLoading(true); setStatus("connecting");
    stickRef.current = true;

    let client: ReturnType<typeof createClient>;
    try { client = createClient(); } catch { setStatus("offline"); setLoading(false); return () => { active = false; }; }

    void (async () => {
      const { data, error } = await client.rpc("campaign_chat_participants", { p_campaign: campaignId });
      if (!active) return;
      if (error) { setNotice("Não foi possível ler os participantes da campanha."); return; }
      setParticipants(((data ?? []) as ParticipantRow[]).map(toParticipant).filter((row): row is ChatParticipant => row !== null));
    })();

    const onChange = (payload: { eventType: string; new: unknown; old: unknown }) => {
      if (!active) return;
      const change = (payload.eventType === "DELETE"
        ? { eventType: "DELETE", old: payload.old as { id?: unknown } }
        : { eventType: payload.eventType, new: payload.new }) as ChatChange;
      setMessages((rows) => applyChatChange(rows, change, campaignId));
    };

    // RLS on campaign_chat_messages decides which rows each subscriber receives (private ones only
    // reach author and recipient). DELETE events cannot be filtered, so they only carry the id.
    const sync = startRealtimeSync<RealtimeChannel>({
      client,
      topic: chatTopic(campaignId),
      bind: (channel) => channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "campaign_chat_messages", filter: `campaign_id=eq.${campaignId}` }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "campaign_chat_messages", filter: `campaign_id=eq.${campaignId}` }, onChange)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "campaign_chat_messages" }, onChange),
      onStatus: (next) => { if (active) setStatus(next); },
      onResync: () => { void loadMessages(); },
    });
    syncRef.current = sync;
    void loadMessages();

    return () => {
      active = false;
      syncRef.current = null;
      sync.stop();
    };
  }, [campaignId, loadMessages, setMessages]);

  // Keep the newest message in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const viewer = participants.find((participant) => participant.userId === viewerId);
  const recipients = privateRecipients(participants, viewerId);
  const names = new Map(participants.map((participant) => [participant.userId, participant.userId === viewerId ? "você" : participant.name]));
  const validation = validateChatDraft(draft);

  async function deliver(message: ChatMessage) {
    const requestCampaign = campaignRef.current;
    setMessages((rows) => setMessageStatus(rows, message.id, "sending"));
    const { data, error } = await createClient().from("campaign_chat_messages")
      .insert({ id: message.id, campaign_id: message.campaign_id, recipient_id: message.recipient_id, body: message.body })
      .select(CHAT_COLUMNS).single();
    if (campaignRef.current !== requestCampaign) return false;
    if (error) {
      if (error.code === "23505") { await loadMessages(); return true; } // already stored by an earlier attempt
      setMessages((rows) => setMessageStatus(rows, message.id, "failed"));
      setNotice(chatErrorMessage(error));
      return false;
    }
    const saved = parseChatMessage(data);
    setMessages((rows) => saved ? mergeMessages(rows, [saved]) : setMessageStatus(rows, message.id, undefined));
    return true;
  }

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (sending) return;
    const result = validateChatDraft(draft);
    if (!result.ok) { setNotice(result.error); return; }
    const target = recipient && recipients.some((person) => person.userId === recipient) ? recipient : null;
    const message: ChatMessage = {
      id: crypto.randomUUID(), campaign_id: campaignId, author_id: viewerId, author_name: viewer?.name ?? "", author_role: viewer?.role ?? (canManage ? "narrador" : "convidado"),
      recipient_id: target, body: result.body, created_at: new Date().toISOString(), edited_at: null, status: "sending",
    };
    stickRef.current = true;
    setNotice(""); setSending(true);
    setMessages((rows) => mergeMessages(rows, [message]));
    setDraft("");
    try {
      const ok = await deliver(message);
      if (!ok && campaignRef.current === message.campaign_id) setDraft((current) => current || result.body);
    } finally {
      setSending(false);
    }
  }

  async function retry(message: ChatMessage) {
    setNotice("");
    await deliver(message);
  }

  async function remove(message: ChatMessage) {
    if (message.status === "failed") { setMessages((rows) => removeMessage(rows, message.id)); return; }
    const moderating = message.author_id !== viewerId;
    if (!window.confirm(moderating ? "Apagar a mensagem deste participante para toda a mesa?" : "Apagar sua mensagem?")) return;
    const requestCampaign = campaignRef.current;
    const { error } = await createClient().from("campaign_chat_messages").delete().eq("id", message.id);
    if (campaignRef.current !== requestCampaign) return;
    if (error) { setNotice(chatErrorMessage(error)); return; }
    setMessages((rows) => removeMessage(rows, message.id));
    setNotice(moderating ? "Mensagem removida pela moderação." : "Mensagem apagada.");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  return <section className={styles.chat} aria-labelledby={`${uid}-title`} aria-busy={loading}>
    <div className={styles.head}>
      <h3 id={`${uid}-title`}>Chat da mesa</h3>
      <span className={`${styles.badge} ${styles[status]}`} role="status" aria-live="polite"><span className={styles.dot} aria-hidden="true" />{connectionLabel(status)}</span>
      {status !== "connected" && <button type="button" className={styles.linkButton} onClick={() => syncRef.current?.reconnectNow()}>Reconectar</button>}
    </div>
    <ol
      ref={listRef}
      className={styles.list}
      aria-label="Mensagens do chat"
      aria-live="polite"
      aria-relevant="additions"
      tabIndex={0}
      onScroll={(event) => { const list = event.currentTarget; stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48; }}
    >
      {loading && !messages.length ? <li className={styles.muted}>Carregando mensagens…</li>
        : !messages.length ? <li className={styles.muted}>Nenhuma mensagem ainda. Diga olá para a mesa.</li>
        : messages.map((message) => {
          const visibility = messageVisibility(message, viewerId);
          const own = message.author_id === viewerId;
          const classes = [styles.message, own ? styles.own : "", visibility !== "public" ? styles.private : "", message.author_role === "narrador" ? styles.narrator : "", message.status === "failed" ? styles.failed : ""].filter(Boolean).join(" ");
          return <li key={message.id} className={classes}>
            <div className={styles.meta}>
              <strong className={styles.author}>{authorLabel(message, viewerId)}</strong>
              <span className={styles.role}>{CHAT_ROLE_LABELS[message.author_role]}</span>
              {visibility === "private-sent" && <span className={styles.privateTag}>Privada para {names.get(message.recipient_id ?? "") ?? "participante"}</span>}
              {visibility === "private-received" && <span className={styles.privateTag}>{message.author_role === "narrador" ? "Sussurro para você" : "Privada para você"}</span>}
              <time dateTime={message.created_at} className={styles.time}>{timeLabel(message.created_at)}</time>
              {message.edited_at && <span className={styles.time}>(editada)</span>}
            </div>
            {/* Always rendered as text: React escapes it and no HTML is ever interpreted. */}
            <p className={styles.body}>{message.body}</p>
            <div className={styles.rowActions}>
              {message.status === "sending" && <span className={styles.time}>Enviando…</span>}
              {message.status === "failed" && <><span className={styles.errorText}>Não enviada.</span><button type="button" className={styles.linkButton} onClick={() => void retry(message)}>Tentar de novo</button></>}
              {canDeleteMessage(message, viewerId, canManage) && <button type="button" className={styles.linkButton} onClick={() => void remove(message)} aria-label={`Apagar mensagem de ${authorLabel(message, viewerId)}`}>{message.status === "failed" ? "Descartar" : "Apagar"}</button>}
            </div>
          </li>;
        })}
    </ol>
    <form className={styles.form} onSubmit={(event) => void send(event)}>
      <label htmlFor={`${uid}-to`}>Para
        <select id={`${uid}-to`} value={recipient} onChange={(event) => setRecipient(event.target.value)}>
          <option value="">Toda a mesa</option>
          {recipients.map((person) => <option key={person.userId} value={person.userId}>{viewer?.role === "narrador" ? "Sussurrar para" : "Privado para"} {person.name} ({CHAT_ROLE_LABELS[person.role]})</option>)}
        </select>
      </label>
      <label htmlFor={`${uid}-draft`} className={styles.draftLabel}>Mensagem
        <textarea id={`${uid}-draft`} value={draft} maxLength={CHAT_MAX_LENGTH} rows={2} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder={recipient ? "Mensagem privada" : "Fale com a mesa (Enter envia, Shift+Enter quebra linha)"} />
      </label>
      <div className={styles.formFoot}>
        <span className={styles.counter} aria-live="off">{draft.length}/{CHAT_MAX_LENGTH}</span>
        <button type="submit" disabled={sending || !validation.ok}>{sending ? "Enviando…" : "Enviar"}</button>
      </div>
    </form>
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </section>;
}
