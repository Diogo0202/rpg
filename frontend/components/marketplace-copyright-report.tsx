"use client";

import { FormEvent, useId, useState } from "react";
import { buildCopyrightReport, copyrightReportPath, emptyCopyrightDraft, type CopyrightDraft } from "../lib/marketplace-copyright";
import styles from "./marketplace-panel.module.css";

type Props = {
  systemId: string;
  systemName: string;
  token: string | null;
  submit: (path: string, body: unknown) => Promise<unknown>;
  onReported: (systemId: string) => void;
};

/** Botão "Reportar Copyright" com formulário; usa o fluxo de denúncias do marketplace. Sem upload de arquivos. */
export function MarketplaceCopyrightReport({ systemId, systemName, token, submit, onReported }: Props) {
  const id = useId();
  const [draft, setDraft] = useState<CopyrightDraft>(emptyCopyrightDraft);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const update = (patch: Partial<CopyrightDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) { setStatus("Entre na sua conta para reportar."); return; }
    const built = buildCopyrightReport(draft);
    if (!built.ok) { setStatus(built.error); return; }
    setBusy(true); setStatus("");
    try {
      await submit(copyrightReportPath(systemId), built.payload);
      setDraft(emptyCopyrightDraft);
      setStatus("Denúncia de copyright registrada para moderação.");
      onReported(systemId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Não foi possível registrar a denúncia.");
    } finally { setBusy(false); }
  }

  return <details className={styles.report}>
    <summary>Reportar Copyright</summary>
    <form className={styles.copyrightForm} onSubmit={(event) => void send(event)} aria-label={`Reportar copyright de ${systemName}`}>
      <p className={styles.hint}>Use se este modelo reproduz obra protegida sem autorização. Envie apenas texto e, se quiser, um link; arquivos não são aceitos.</p>
      <label htmlFor={`${id}-reason`}>Motivo (copyright)</label>
      <textarea id={`${id}-reason`} required minLength={10} maxLength={2000} rows={3} value={draft.reason} onChange={(event) => update({ reason: event.target.value })} />
      <label htmlFor={`${id}-work`}>Obra alegada</label>
      <input id={`${id}-work`} required minLength={2} maxLength={300} value={draft.claimedWork} onChange={(event) => update({ claimedWork: event.target.value })} />
      <label htmlFor={`${id}-holder`}>Titular alegado dos direitos</label>
      <input id={`${id}-holder`} required minLength={2} maxLength={200} value={draft.rightsHolder} onChange={(event) => update({ rightsHolder: event.target.value })} />
      <label htmlFor={`${id}-link`}>Link para a obra (opcional)</label>
      <input id={`${id}-link`} type="url" inputMode="url" maxLength={500} placeholder="https://" value={draft.evidenceUrl} onChange={(event) => update({ evidenceUrl: event.target.value })} />
      <label className={styles.checkInline}><input type="checkbox" required checked={draft.goodFaith} onChange={(event) => update({ goodFaith: event.target.checked })} />Declaro de boa-fé que as informações são verdadeiras e que o uso não é autorizado pelo titular.</label>
      <button type="submit" disabled={busy || !token}>{busy ? "Enviando…" : "Enviar denúncia de copyright"}</button>
      {!token && <p className={styles.hint}>Entre na conta para reportar.</p>}
      {status && <p className={styles.hint} role="status">{status}</p>}
    </form>
  </details>;
}
