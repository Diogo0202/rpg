"use client";

import { attackDamageSplit } from "../lib/v5-action-roll";
import { DiceTrayOverlay } from "./dice-tray";
import { GuidedRollCard, IntegrityCard } from "./v5-action/cards";
import { HistoryItem } from "./v5-action/history-item";
import { useV5Action } from "./v5-action/use-v5-action";
import styles from "./v5-action-panel.module.css";

export { describeDamageResult } from "../lib/v5-action-roll";
export { deriveDamageState } from "./v5-action/model";

/** Rolagem V5 guardada no servidor, rerrolagem com Vontade, dano de ataque e trilhas de integridade. */
export function V5ActionPanel({ campaignId, canEdit, canNarrate = false }: { campaignId: string; canEdit: boolean; canNarrate?: boolean }) {
  const action = useV5Action(campaignId, canEdit, canNarrate);
  const { character, history } = action;

  if (!character) return <section className={`content ${styles.panel}`}><h2>Rolagem V5 e integridade</h2><p>Selecione uma ficha salva para rolar ações e acompanhar dano.</p></section>;

  return <section className={`content ${styles.panel}`} aria-busy={action.busy}>
    <DiceTrayOverlay roll={action.tray} onDone={action.closeTray} />
    <header className={styles.header}><div><p className={styles.eyebrow}>V5 · AÇÃO E INTEGRIDADE</p><h2>{character.name}</h2></div><p>O servidor rola e guarda os dados com a Fome e as condições salvas da ficha. Depois, até 3 dados comuns podem ser rerrolados uma vez com Vontade.</p></header>
    <div className={styles.layout}>
      <div className={styles.column}>
        <GuidedRollCard action={action} />
        <IntegrityCard action={action} canEdit={canEdit} />
      </div>
      <div className={styles.column}>
        <article className={styles.card}>
          <h3>Histórico desta ficha</h3>
          <p className={styles.note}>As rolagens ficam guardadas no servidor; esta lista junta as desta sessão com as últimas guardadas da ficha.</p>
          {history.remoteError && <p role="status" className={styles.message}>{history.remoteError}</p>}
          {history.entries.length === 0 ? <p>Nenhuma rolagem ainda.</p> : <ol className={styles.history}>
            {history.entries.map((entry, index) => <HistoryItem key={entry.roll.id} action={action} entry={entry} latest={index === 0} canNarrate={canNarrate} />)}
          </ol>}
          {!canNarrate && history.entries.some((entry) => attackDamageSplit(entry.attack)) && <p className={styles.note}>O narrador aplica o dano do ataque na ficha do alvo.</p>}
          {action.message && <p role="status" className={styles.message}>{action.message}</p>}
        </article>
      </div>
    </div>
  </section>;
}
