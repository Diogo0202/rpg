"use client";

import { useId } from "react";

import { connectionLabel } from "../lib/realtime-sync";
import { EventsSection } from "./campaign-journal/events-section";
import { FactionsSection } from "./campaign-journal/factions-section";
import { SessionsSection } from "./campaign-journal/sessions-section";
import { useCampaignJournal } from "./campaign-journal/use-campaign-journal";
import styles from "./campaign-journal-panel.module.css";

/** Diário da campanha: sessões, relógios de facção e linha do tempo com vínculos ao mundo. */
export function CampaignJournalPanel({ campaignId, canManage }: { campaignId: string; canManage: boolean }) {
  const id = useId();
  const journal = useCampaignJournal(campaignId, canManage);
  const inputId = (name: string) => `${id}-${name}`;
  const sectionProps = { journal, canManage, inputId };

  return (
    <section className={styles.panel} aria-labelledby={inputId("title")} aria-busy={journal.loading || journal.saving}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>REGISTROS DA CAMPANHA</p>
          <h2 id={inputId("title")}>Diário e linha do tempo</h2>
        </div>
        <div className={styles.exportActions}>
          <button type="button" className={styles.secondaryButton} onClick={journal.exportJson} disabled={journal.loading}>Exportar JSON</button>
          <button type="button" className={styles.secondaryButton} onClick={journal.exportMarkdown} disabled={journal.loading}>Exportar Markdown</button>
        </div>
      </div>

      <p className={styles.intro}>Sessões, eventos da crônica e tensão das facções ficam salvos nesta campanha.</p>
      <p className={styles.recordMeta} role="status">Sincronização: {connectionLabel(journal.syncStatus)}</p>
      <p className={styles.message} role="status" aria-live="polite">{journal.message}</p>

      {/* A chave descarta formulários e filtros abertos quando a campanha muda. */}
      <SessionsSection key={`sessions-${campaignId}`} {...sectionProps} />
      <FactionsSection key={`factions-${campaignId}`} {...sectionProps} />
      <EventsSection key={`events-${campaignId}`} {...sectionProps} />
    </section>
  );
}
