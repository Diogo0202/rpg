"use client";

import { useEffect, useState } from "react";

import { hasValidInvite, loadVoiceSession, requestVoiceRoom, voiceEnabled, type VoiceSession } from "../lib/voice-session";
import styles from "./voice-session-panel.module.css";

const STATUS_LABELS = { pending: "Criando a sala…", ready: "Sala pronta", failed: "Falhou" } as const;

/**
 * Discord voice room for the scene. Members see "Entrar na voz" only while a valid invite exists;
 * the narrator sees "Criar sala de voz" and the state when the server has Discord configured.
 * `refreshKey` changes when the private live channel signals a voice update (or reconnects).
 */
export function VoiceSessionPanel({ campaignId, canManage, refreshKey }: { campaignId: string; canManage: boolean; refreshKey: number }) {
  const [session, setSession] = useState<VoiceSession | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    void loadVoiceSession(campaignId).then((next) => { if (active) { setSession(next); setNow(Date.now()); } }).catch(() => { /* RLS or offline: keep hidden */ });
    return () => { active = false; };
  }, [campaignId, refreshKey]);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void voiceEnabled().then((value) => { if (active) setEnabled(value); });
    return () => { active = false; };
  }, [canManage]);

  // While pending, poll lightly in case the Realtime signal was missed.
  useEffect(() => {
    if (session?.status !== "pending") return;
    const timer = setInterval(() => {
      void loadVoiceSession(campaignId).then((next) => { setSession(next); setNow(Date.now()); }).catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [campaignId, session?.status]);

  async function create() {
    setBusy(true); setNotice("");
    try {
      await requestVoiceRoom(campaignId);
      setSession(await loadVoiceSession(campaignId));
      setNow(Date.now());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível criar a sala de voz.");
    } finally {
      setBusy(false);
    }
  }

  const valid = hasValidInvite(session, now);
  if (!valid && !(canManage && enabled)) return null;

  return <div className={styles.voice}>
    {valid && session?.inviteUrl && <a className={styles.join} href={session.inviteUrl} target="_blank" rel="noopener noreferrer">Entrar na voz</a>}
    {canManage && enabled && <>
      {!valid && <button type="button" className={styles.create} onClick={() => void create()} disabled={busy || session?.status === "pending"}>Criar sala de voz</button>}
      {session && <span className={styles.state} role="status" aria-live="polite">
        Discord: {valid ? STATUS_LABELS.ready : session.status === "ready" ? "Convite expirado" : STATUS_LABELS[session.status]}
        {session.status === "failed" && session.error ? ` (${session.error})` : ""}
        {valid && session.expiresAt ? ` · vale até ${new Date(session.expiresAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : ""}
      </span>}
    </>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
  </div>;
}
