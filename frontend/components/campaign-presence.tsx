"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { createClient } from "../lib/supabase/client";
import {
  canSendPing, connectionLabel, liveTopic, presenceMembers, roleFromMembership, startRealtimeSync,
  type PresenceMember, type PresenceMeta, type PresenceRole, type RealtimeConnection,
} from "../lib/realtime-sync";
import styles from "./campaign-presence.module.css";
import { VoiceSessionPanel } from "./voice-session-panel";

type Ping = { message: string; at: string };
const ROLE_LABELS: Record<PresenceRole, string> = { narrador: "Narrador", jogador: "Jogador", convidado: "Convidado" };

/** Who is online in the campaign (private Realtime Presence) and the narrator's attention ping. */
export function CampaignPresence({ campaignId, viewerId, canManage }: { campaignId: string; viewerId: string; canManage: boolean }) {
  const uid = useId();
  const [status, setStatus] = useState<RealtimeConnection>("connecting");
  const [online, setOnline] = useState<PresenceMember[]>([]);
  const [ping, setPing] = useState<Ping | null>(null);
  const [pingDraft, setPingDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [voiceRefresh, setVoiceRefresh] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const rolesRef = useRef<Record<string, PresenceRole>>({});
  const nameRef = useRef("");
  const lastPingRef = useRef<number | null>(null);
  const syncRef = useRef<{ reconnectNow(): void } | null>(null);

  useEffect(() => {
    let active = true;
    let dismiss: ReturnType<typeof setTimeout> | null = null;
    setOnline([]); setPing(null); setStatus("connecting"); setNotice("");
    rolesRef.current = {};

    let client: ReturnType<typeof createClient>;
    try { client = createClient(); } catch { setStatus("offline"); return () => { active = false; }; }

    const recompute = () => {
      const channel = channelRef.current;
      if (!active || !channel) return;
      setOnline(presenceMembers(channel.presenceState() as Record<string, PresenceMeta[]>, rolesRef.current, viewerId));
    };
    const track = () => {
      const channel = channelRef.current;
      if (!channel) return;
      void channel.track({ user_id: viewerId, name: nameRef.current, online_at: new Date().toISOString() });
    };

    async function loadMembership() {
      const [campaign, members, profile] = await Promise.all([
        client.from("campaigns").select("owner_id").eq("id", campaignId).maybeSingle(),
        client.from("campaign_members").select("user_id,role").eq("campaign_id", campaignId),
        client.from("profiles").select("display_name").eq("id", viewerId).maybeSingle(),
      ]);
      if (!active) return;
      const ownerId = (campaign.data?.owner_id as string | undefined) ?? null;
      const roles: Record<string, PresenceRole> = {};
      for (const row of (members.data ?? []) as { user_id: string; role: string }[]) roles[row.user_id] = roleFromMembership(row.role, row.user_id === ownerId);
      if (ownerId) roles[ownerId] = "narrador";
      rolesRef.current = roles;
      nameRef.current = typeof profile.data?.display_name === "string" ? profile.data.display_name : "";
      recompute();
      track();
    }

    const sync = startRealtimeSync<RealtimeChannel>({
      client,
      topic: liveTopic(campaignId),
      config: { private: true, presence: { key: viewerId }, broadcast: { self: false } },
      bind: (channel) => channel
        .on("presence", { event: "sync" }, recompute)
        .on("broadcast", { event: "attention" }, ({ payload }) => {
          if (!active || !payload || typeof payload !== "object") return;
          const data = payload as { from?: unknown; message?: unknown; at?: unknown };
          // The server only lets managers broadcast; double-check against the membership we read.
          if (typeof data.from !== "string" || rolesRef.current[data.from] !== "narrador") return;
          const message = typeof data.message === "string" ? data.message.slice(0, 120) : "";
          setPing({ message, at: typeof data.at === "string" ? data.at : new Date().toISOString() });
          try { navigator.vibrate?.(200); } catch { /* not supported */ }
          if (dismiss) clearTimeout(dismiss);
          dismiss = setTimeout(() => { if (active) setPing(null); }, 10000);
        })
        // Voice room signal from the API (service key). Only a hint: the panel rereads the row via RLS.
        .on("broadcast", { event: "voice" }, () => { if (active) setVoiceRefresh((value) => value + 1); }),
      onChannel: (channel) => { channelRef.current = channel; },
      onStatus: (next) => { if (active) setStatus(next); },
      onResync: () => { track(); recompute(); if (active) setVoiceRefresh((value) => value + 1); },
    });
    syncRef.current = sync;
    void loadMembership().catch(() => { if (active) setNotice("Não foi possível ler os membros da campanha."); });

    return () => {
      active = false;
      if (dismiss) clearTimeout(dismiss);
      syncRef.current = null;
      sync.stop();
    };
  }, [campaignId, viewerId]);

  async function sendPing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const channel = channelRef.current;
    if (!canManage || !channel || status !== "connected") return;
    const now = Date.now();
    if (!canSendPing(lastPingRef.current, now)) { setNotice("Aguarde alguns segundos antes de chamar de novo."); return; }
    lastPingRef.current = now;
    const result = await channel.send({ type: "broadcast", event: "attention", payload: { from: viewerId, message: pingDraft.trim().slice(0, 120), at: new Date(now).toISOString() } });
    setNotice(result === "ok" ? "Chamado enviado para a mesa." : "O chamado não foi entregue. Confira a conexão.");
    if (result === "ok") setPingDraft("");
  }

  return <section className={styles.presence} aria-labelledby={`${uid}-title`}>
    <div className={styles.head}>
      <h3 id={`${uid}-title`}>Na mesa agora</h3>
      <span className={`${styles.badge} ${styles[status]}`} role="status" aria-live="polite"><span className={styles.dot} aria-hidden="true" />{connectionLabel(status)}</span>
      {status !== "connected" && <button type="button" className={styles.linkButton} onClick={() => syncRef.current?.reconnectNow()}>Reconectar</button>}
    </div>
    <VoiceSessionPanel campaignId={campaignId} canManage={canManage} refreshKey={voiceRefresh} />
    {ping && <p className={styles.ping} role="alert"><strong>O narrador pediu atenção.</strong>{ping.message ? ` ${ping.message}` : ""}</p>}
    {online.length ? <ul className={styles.list} aria-label="Participantes online">
      {online.map((member) => <li key={member.userId} className={member.role === "narrador" ? styles.narrator : undefined}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.name}>{member.self ? `${member.name} (você)` : member.name}</span>
        <span className={styles.role}>{ROLE_LABELS[member.role]}</span>
      </li>)}
    </ul> : <p className={styles.muted}>{status === "connected" ? "Ninguém mais conectado." : "A presença aparece quando o tempo real conectar."}</p>}
    {canManage && <form className={styles.pingForm} onSubmit={(event) => void sendPing(event)}>
      <label htmlFor={`${uid}-ping`}>Recado curto (opcional)<input id={`${uid}-ping`} value={pingDraft} maxLength={120} onChange={(event) => setPingDraft(event.target.value)} placeholder="Ex.: voltem para a cena" /></label>
      <button type="submit" disabled={status !== "connected"}>Pedir atenção</button>
    </form>}
    {notice && <p className={styles.muted} role="status">{notice}</p>}
  </section>;
}
