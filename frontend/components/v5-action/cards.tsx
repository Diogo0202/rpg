"use client";

import { bloodPotency } from "../../../shared/rules/v5-blood";
import styles from "../v5-action-panel.module.css";
import { integerValue, trackDamage, TRACK_NAMES, type Track, type TrackDamage } from "./model";
import type { V5Action } from "./use-v5-action";

const DAMAGE_KINDS = [["superficial", "Superficial"], ["aggravated", "Agravado"]] as const;

function TrackCard({ action, canEdit, track, damage }: { action: V5Action; canEdit: boolean; track: Track; damage: TrackDamage }) {
  const title = TRACK_NAMES[track];
  return <article className={styles.trackCard}>
    <div className={styles.trackHeading}><div><span>{title}</span><b>{damage.superficial + damage.aggravated}/{damage.max || "sem trilha"}</b></div>
      {damage.max > 0 && <div className={styles.boxes} aria-label={`${title}: ${damage.superficial} superficial e ${damage.aggravated} agravado de ${damage.max}`}>
        {Array.from({ length: damage.max }, (_, index) => {
          const filled = index < damage.superficial + damage.aggravated;
          const severe = filled && index >= damage.superficial;
          return <i key={index} className={severe ? styles.aggravatedBox : filled ? styles.superficialBox : ""} />;
        })}
      </div>}
    </div>
    {damage.max === 0 ? <p>Esta ficha não tem valores para calcular a trilha.</p> : <div className={styles.damageControls}>
      {DAMAGE_KINDS.map(([kind, label]) => {
        const count = kind === "superficial" ? damage.superficial : damage.aggravated;
        return <div className={styles.damageKind} key={kind}><span>{label}: {count}</span>
          <button type="button" disabled={!canEdit || action.busy || count === 0} onClick={() => void action.changeDamage(track, kind, -1)} aria-label={`Remover dano ${label.toLowerCase()} de ${title}`}>−</button>
          <button type="button" disabled={!canEdit || action.busy || damage.aggravated >= damage.max} onClick={() => void action.changeDamage(track, kind, 1)} aria-label={`Adicionar dano ${label.toLowerCase()} a ${title}`}>+</button>
        </div>;
      })}
    </div>}
    <small>{track === "health" ? "Máximo calculado por Vigor + 3." : "Máximo calculado por Autocontrole + Resolução."}</small>
  </article>;
}

export function GuidedRollCard({ action }: { action: V5Action }) {
  const { character, busy, roll, attributeChoices, skillChoices, contextTags } = action;
  if (!character) return null;
  const hungerValue = integerValue(character.values.fome);
  const surgeDice = bloodPotency(integerValue(character.values.potencia_sangue) ?? 0).surge;
  return <article className={styles.card}>
    <h3>Rolagem guiada</h3>
    {action.fieldsError && <p role="status" className={styles.message}>{action.fieldsError}</p>}
    <div className={styles.selectGrid}>
      <label>Atributo<select value={roll.attributeId} onChange={(event) => roll.setAttributeId(event.target.value)} disabled={!attributeChoices.length}>
        {attributeChoices.map((field) => <option key={field.id} value={field.id}>{field.label} · {field.value}</option>)}
      </select></label>
      <label>Habilidade<select value={roll.skillId} onChange={(event) => roll.setSkillId(event.target.value)} disabled={!skillChoices.length}>
        {skillChoices.map((field) => <option key={field.id} value={field.id}>{field.label} · {field.value}</option>)}
      </select></label>
    </div>
    {action.fieldsLoaded && !action.fieldsError && skillChoices.length === 0 && <p className={styles.note}>Esta ficha não tem campos numéricos de habilidade. Use o pool manual ou acrescente habilidades ao modelo.</p>}
    <p className={styles.poolLine}>Parada selecionada: <b>{roll.selectedPool} dados</b></p>
    <label className={styles.inlineLabel}>Dificuldade<input type="number" min={1} max={100} value={roll.difficulty} onChange={(event) => roll.setDifficulty(Number(event.target.value))} /></label>
    <label className={styles.inlineLabel}><input type="checkbox" checked={roll.useSurge} disabled={hungerValue === 5 && !roll.useSurge} onChange={(event) => roll.setUseSurge(event.target.checked)} /> Usar Surto de Sangue (+{surgeDice} dados)</label>
    {roll.useSurge && <label className={styles.inlineLabel}>Chave da rodada<input value={roll.turnKey} maxLength={120} placeholder="c1:r1" onChange={(event) => roll.setTurnKey(event.target.value)} /></label>}
    {roll.useSurge && <p className={styles.note}>O servidor faz a Checagem de Sangue, soma o bônus na rolagem guardada e impede outro Surto com a mesma chave de rodada.</p>}
    <div className={styles.quickGroups}>
      <div><h4>Rolagem rápida · atributos</h4><div className={styles.quickButtons}>{attributeChoices.map((field) => <button type="button" key={field.id} disabled={busy || hungerValue === null} onClick={() => action.quickRoll(field, "attribute")}>{field.label} {field.value}</button>)}</div></div>
      <div><h4>Rolagem rápida · habilidades</h4><div className={styles.quickButtons}>{skillChoices.map((field) => <button type="button" key={field.id} disabled={busy || hungerValue === null} onClick={() => action.quickRoll(field, "skill")}>{field.label} {field.value}</button>)}</div></div>
    </div>
    <form onSubmit={(event) => { event.preventDefault(); action.rollManual(); }} className={styles.manualForm}>
      <label>Pool manual<input type="number" min={0} max={30} value={roll.manualPool} onChange={(event) => roll.setManualPool(Number(event.target.value))} /></label>
      <button type="submit" disabled={busy || hungerValue === null}>Rolar pool manual</button>
    </form>
    <label className={styles.inlineLabel}><input type="checkbox" checked={roll.attackMode} onChange={(event) => roll.setAttackMode(event.target.checked)} /> Ataque: somar dano da arma equipada</label>
    <p className={styles.note}>Fome da ficha: {hungerValue ?? "inválida"} · Tags de contexto: {contextTags.join(", ") || "nenhuma"}</p>
    <p className={styles.note}>Rolagens rápidas registram o atributo e a habilidade usados como atividade da crônica.</p>
  </article>;
}

export function IntegrityCard({ action, canEdit }: { action: V5Action; canEdit: boolean }) {
  const { character, incoming, setIncoming } = action;
  if (!character) return null;
  return <article className={styles.card}>
    <h3>Integridade</h3>
    <div className={styles.tracks}>
      <TrackCard action={action} canEdit={canEdit} track="health" damage={trackDamage(character.values, "health")} />
      <TrackCard action={action} canEdit={canEdit} track="willpower" damage={trackDamage(character.values, "willpower")} />
    </div>
    <p className={styles.note}>Adicionar dano passa pelo servidor: com a trilha cheia, cada novo ponto converte um superficial em agravado. A penalidade de −2 entra no servidor quando a trilha relevante está cheia.</p>
    <form className={styles.manualForm} onSubmit={(event) => { event.preventDefault(); void action.applyDamage(incoming.track, incoming.superficial, incoming.aggravated, incoming.armor, incoming.physical); }}>
      <label>Trilha<select value={incoming.track} onChange={(event) => setIncoming({ ...incoming, track: event.target.value as Track })}>
        <option value="health">{TRACK_NAMES.health}</option><option value="willpower">{TRACK_NAMES.willpower}</option>
      </select></label>
      <label>Superficial<input type="number" min={0} max={30} value={incoming.superficial} onChange={(event) => setIncoming({ ...incoming, superficial: Number(event.target.value) })} /></label>
      <label>Agravado<input type="number" min={0} max={30} value={incoming.aggravated} onChange={(event) => setIncoming({ ...incoming, aggravated: Number(event.target.value) })} /></label>
      <label className={styles.inlineLabel}><input type="checkbox" checked={incoming.armor} disabled={incoming.track !== "health"} onChange={(event) => setIncoming({ ...incoming, armor: event.target.checked })} /> Aplicar armadura equipada</label>
      <label className={styles.inlineLabel}><input type="checkbox" checked={incoming.physical} disabled={incoming.track !== "health"} onChange={(event) => setIncoming({ ...incoming, physical: event.target.checked })} /> Dano físico (vampiro reduz o superficial à metade)</label>
      <button type="submit" disabled={!canEdit || action.busy}>Receber dano</button>
    </form>
    <p className={styles.note}>A proteção da armadura equipada reduz apenas dano superficial à Saúde e é lida pelo servidor.</p>
  </article>;
}
