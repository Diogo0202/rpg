"use client";

import { FormEvent, useState } from "react";

import styles from "../campaign-journal-panel.module.css";
import { dateLabel, emptySession, sessionDraftOf, SESSION_STATUS_LABELS, type SessionDraft, type SessionStatus } from "./model";
import type { CampaignJournal } from "./use-campaign-journal";

type Props = { journal: CampaignJournal; canManage: boolean; inputId: (name: string) => string };

export function SessionsSection({ journal, canManage, inputId }: Props) {
  const { sessions, loading, saving } = journal;
  const [draft, setDraft] = useState<SessionDraft | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft && await journal.saveSession(draft)) setDraft(null);
  }

  return (
    <section className={styles.section} aria-labelledby={inputId("sessions-title")}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>CRONOLOGIA DE MESA</p><h3 id={inputId("sessions-title")}>Sessões</h3></div>
        <div className={styles.sectionActions}>
          <button className={styles.secondaryButton} type="button" onClick={journal.refresh} disabled={loading || saving}>Atualizar</button>
          {canManage && <button className={styles.primaryButton} type="button" disabled={saving} onClick={() => setDraft(emptySession(Math.max(0, ...sessions.map((item) => item.sequence)) + 1))}>Nova sessão</button>}
        </div>
      </div>
      {draft && canManage && (
        <form className={styles.form} onSubmit={submit}>
          <fieldset disabled={saving} className={styles.editingFields}>
            <div className={styles.formGrid}>
              <label htmlFor={inputId("session-sequence")}>Sequência<input id={inputId("session-sequence")} type="number" min="1" step="1" required value={draft.sequence} onChange={(event) => setDraft({ ...draft, sequence: event.target.value })} /></label>
              <label htmlFor={inputId("session-title")}>Título<input id={inputId("session-title")} maxLength={160} required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
              <label htmlFor={inputId("session-status")}>Status<select id={inputId("session-status")} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as SessionStatus })}>{Object.entries(SESSION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label htmlFor={inputId("session-date")}>Data da sessão<input id={inputId("session-date")} type="date" value={draft.played_on} onChange={(event) => setDraft({ ...draft, played_on: event.target.value })} /></label>
            </div>
            <label htmlFor={inputId("session-summary")}>Resumo<textarea id={inputId("session-summary")} rows={3} maxLength={12000} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
            <div className={styles.formActions}><button className={styles.primaryButton} disabled={saving}>{draft.id ? "Salvar sessão" : "Criar sessão"}</button><button className={styles.secondaryButton} type="button" onClick={() => setDraft(null)}>Cancelar</button></div>
          </fieldset>
        </form>
      )}
      {loading ? <p className={styles.empty}>Carregando sessões…</p> : sessions.length === 0 ? <p className={styles.empty}>Nenhuma sessão registrada nesta campanha.</p> : (
        <ol className={styles.sessionList}>
          {sessions.map((item) => <li className={styles.sessionCard} key={item.id}>
            <div className={styles.recordHeading}><div><span className={styles.sequence}>Sessão {item.sequence}</span><h4>{item.title}</h4></div><span className={styles.badge}>{SESSION_STATUS_LABELS[item.status]}</span></div>
            <p className={styles.recordMeta}>{dateLabel(item.played_on)}</p>
            <p className={styles.recordText}>{item.summary || "Sem resumo registrado."}</p>
            {canManage && <div className={styles.rowActions}><button type="button" className={styles.textButton} disabled={saving} onClick={() => setDraft(sessionDraftOf(item))}>Editar</button><button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void journal.deleteSession(item)}>Excluir</button></div>}
          </li>)}
        </ol>
      )}
    </section>
  );
}
