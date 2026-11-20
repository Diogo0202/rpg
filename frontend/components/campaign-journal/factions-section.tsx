"use client";

import { FormEvent, useState } from "react";

import styles from "../campaign-journal-panel.module.css";
import { emptyFaction, factionDraftOf, type CampaignFaction, type FactionDraft } from "./model";
import type { CampaignJournal } from "./use-campaign-journal";

type Props = { journal: CampaignJournal; canManage: boolean; inputId: (name: string) => string };

function TensionClock({ item }: { item: CampaignFaction }) {
  const broken = item.tension >= item.limit;
  return <div className={styles.clockRow}>
    <div className={styles.clockTrack} role="meter" aria-label={`Tensão de ${item.name}`} aria-valuemin={0} aria-valuemax={item.limit} aria-valuenow={Math.min(item.tension, item.limit)} aria-valuetext={`${item.tension} de ${item.limit}${broken ? ", Ruptura" : ""}`}>
      {Array.from({ length: item.limit }, (_, index) => <span className={`${styles.clockSegment} ${index < item.tension ? (broken ? styles.segmentBroken : styles.segmentFilled) : ""}`} key={index} />)}
    </div>
    <strong className={styles.clockValue}>{item.tension}/{item.limit}</strong>
  </div>;
}

export function FactionsSection({ journal, canManage, inputId }: Props) {
  const { factions, loading, saving } = journal;
  const [draft, setDraft] = useState<FactionDraft | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft && await journal.saveFaction(draft)) setDraft(null);
  }

  return (
    <section className={styles.section} aria-labelledby={inputId("factions-title")}>
      <div className={styles.sectionHeading}>
        <div><p className={styles.eyebrow}>RELÓGIOS DE TENSÃO</p><h3 id={inputId("factions-title")}>Facções</h3></div>
        {canManage && <button className={styles.primaryButton} type="button" disabled={saving} onClick={() => setDraft(emptyFaction())}>Nova facção</button>}
      </div>
      {draft && canManage && (
        <form className={styles.form} onSubmit={submit}>
          <fieldset disabled={saving} className={styles.editingFields}>
            <div className={styles.formGrid}>
              <label htmlFor={inputId("faction-name")}>Nome<input id={inputId("faction-name")} maxLength={160} required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label htmlFor={inputId("faction-tension")}>Tensão<input id={inputId("faction-tension")} type="number" min="0" max="12" step="1" required value={draft.tension} onChange={(event) => setDraft({ ...draft, tension: event.target.value })} /></label>
              <label htmlFor={inputId("faction-limit")}>Limite do relógio<input id={inputId("faction-limit")} type="number" min="1" max="12" step="1" required value={draft.limit} onChange={(event) => setDraft({ ...draft, limit: event.target.value })} /></label>
            </div>
            <label htmlFor={inputId("faction-description")}>Descrição<textarea id={inputId("faction-description")} rows={2} maxLength={6000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
            <label htmlFor={inputId("faction-goal")}>Objetivo<textarea id={inputId("faction-goal")} rows={2} maxLength={3000} value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} /></label>
            <label htmlFor={inputId("faction-consequence")}>Consequência ao atingir o limite<textarea id={inputId("faction-consequence")} rows={2} maxLength={3000} value={draft.consequence} onChange={(event) => setDraft({ ...draft, consequence: event.target.value })} /></label>
            <div className={styles.formActions}><button className={styles.primaryButton} disabled={saving}>{draft.id ? "Salvar facção" : "Criar facção"}</button><button className={styles.secondaryButton} type="button" onClick={() => setDraft(null)}>Cancelar</button></div>
          </fieldset>
        </form>
      )}
      {loading ? <p className={styles.empty}>Carregando facções…</p> : factions.length === 0 ? <p className={styles.empty}>Nenhuma facção registrada nesta campanha.</p> : (
        <ul className={styles.factionList}>
          {factions.map((item) => {
            const broken = item.tension >= item.limit;
            return <li className={`${styles.factionCard} ${broken ? styles.broken : ""}`} key={item.id}>
              <div className={styles.recordHeading}><div><h4>{item.name}</h4><span className={styles.recordMeta}>{item.description || "Sem descrição registrada."}</span></div>{broken && <span className={styles.rupture}>Ruptura</span>}</div>
              <p className={styles.recordText}><strong>Objetivo:</strong> {item.goal || "Não informado."}</p>
              <p className={styles.recordText}><strong>Consequência:</strong> {item.consequence || "Não informada."}</p>
              <TensionClock item={item} />
              {canManage && <div className={styles.rowActions}>
                <button type="button" className={styles.secondaryButton} aria-label={`Reduzir tensão de ${item.name}`} disabled={saving || item.tension <= 0} onClick={() => void journal.changeTension(item, -1)}>−</button>
                <button type="button" className={styles.secondaryButton} aria-label={`Aumentar tensão de ${item.name}`} disabled={saving || item.tension >= 12} onClick={() => void journal.changeTension(item, 1)}>+</button>
                <button type="button" className={styles.textButton} disabled={saving} onClick={() => setDraft(factionDraftOf(item))}>Editar</button>
                <button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void journal.deleteFaction(item)}>Excluir</button>
              </div>}
            </li>;
          })}
        </ul>
      )}
    </section>
  );
}
