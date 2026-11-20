"use client";

import { isFieldActive, type DistributionTally } from "../../../shared/rules/sheet-creation";
import type { CreationDistribution, FieldValue, SelectGrantsRule, SheetTemplate } from "../../../shared/rules/sheet-template";
import { choiceOptions, grantRules } from "../../../shared/rules/creation-grants";
import type { PoolTally, PriorityTally } from "../../../shared/rules/priority-points";
import styles from "../sheet-creation-wizard.module.css";
import type { SheetWizardState } from "./use-sheet-wizard";
import { bonusStatus, describeMissing, describeOption, formatValue, isOver, slotsOf } from "./wizard-model";

/** One column per value, one dot per point: shows the shape of a mode at a glance. */
function DistributionDots({ option, size }: { option: CreationDistribution; size: number }) {
  return <span className={styles.modeShape} aria-hidden="true">
    {slotsOf(option, size).filter(([value]) => value > 0).map(([value, count]) => <span className={styles.modeColumn} key={value}>
      <span className={styles.modeDots}>{Array.from({ length: value }, (_, index) => <i key={index} />)}</span>
      <b>×{count}</b>
    </span>)}
  </span>;
}

function DistributionCounter({ label, tally }: { label: string; tally: DistributionTally }) {
  return <div className={`${styles.tally} ${tally.complete ? styles.tallyComplete : ""}`} role="status" aria-live="polite">
    <p className={styles.tallyStatus}>{tally.complete ? `${label}: distribuição completa.` : `${label}: ${describeMissing(tally)}`}</p>
    <ul>
      {tally.slots.map((slot) => <li key={slot.value} className={`${styles.tallyRow} ${slot.have === slot.need ? styles.tallyDone : ""} ${isOver(tally, slot) ? styles.tallyOver : ""}`}>
        <span>{slot.value} {slot.value === 1 ? "ponto" : "pontos"}</span>
        <strong>{slot.have} de {slot.need}</strong>
      </li>)}
    </ul>
  </div>;
}

/** Free budgets per group and the freebie points left, for a priority_points rule. */
export function PriorityBoard({ tally, pools }: { tally: PriorityTally; pools: PoolTally[] }) {
  const over = tally.remaining < 0;
  return <div className={`${styles.tally} ${styles.priorityBoard} ${tally.remaining === 0 && !over ? styles.tallyComplete : ""}`} role="status" aria-live="polite">
    <p className={styles.tallyStatus}>{bonusStatus(tally)}</p>
    {pools.map((item) => <section className={styles.priorityPool} key={item.pool.id} aria-label={item.pool.label}>
      <h4>{item.pool.label}{item.pool.cost > 0 && <span>cada ponto de bônus custa {item.pool.cost}</span>}</h4>
      {item.groups.some((group) => group.free > 0) || item.groups.length > 1 || item.groups[0].spent > 0 ? <ul>
        {item.groups.map((group) => {
          const extra = group.spent - group.free;
          return <li key={group.label} className={`${styles.tallyRow} ${extra === 0 ? styles.tallyDone : ""} ${extra > 0 ? styles.priorityBonus : ""}`}>
            <span>{group.label}</span>
            <strong>{group.spent} de {group.free}{extra > 0 ? ` · +${extra} de bônus` : ""}</strong>
          </li>;
        })}
      </ul> : null}
    </section>)}
  </div>;
}

/** Escolha do modo de distribuição de cada regra do passo e o contador de pontos. */
export function DistributionRules({ wizard, busy }: { wizard: SheetWizardState; busy: boolean }) {
  return <>{wizard.stepRules.map((rule) => {
    const selected = wizard.chosenOption(rule);
    const entry = wizard.tallies.find((item) => item.rule.id === rule.id);
    return <div className={styles.distribution} key={rule.id}>
      {rule.options.length > 1 && <fieldset className={styles.modeField}>
        <legend>Escolha o modo de {rule.label.toLowerCase()}</legend>
        <div className={styles.modeGrid}>
          {rule.options.map((option, index) => <label className={`${styles.modeCard} ${selected === index ? styles.modeSelected : ""}`} key={option.label}>
            <input id={index === 0 ? `sheet-mode-${rule.id}` : undefined} type="radio" name={`mode-${rule.id}`} checked={selected === index} disabled={busy} onChange={() => wizard.chooseOption(rule, index)} />
            <strong>{option.label}</strong>
            <DistributionDots option={option} size={rule.fields.length} />
            <small>{describeOption(option, rule.fields.length)}</small>
          </label>)}
        </div>
      </fieldset>}
      {entry ? <DistributionCounter label={rule.label} tally={entry.tally} /> : <p className={styles.modeHint}>Escolha um modo para distribuir os pontos de {rule.label.toLowerCase()}.</p>}
    </div>;
  })}</>;
}

function GrantSummary({ wizard, rule, busy, fieldLabels }: { wizard: SheetWizardState; rule: SelectGrantsRule; busy: boolean; fieldLabels: Map<string, string> }) {
  const entry = wizard.grants.find((item) => item.rule.id === rule.id);
  if (!entry?.case) return null;
  const lines = entry.grants.flatMap((grant) => [
    ...Object.entries(grant.add ?? {}).map(([id, amount]) => `${fieldLabels.get(id) ?? id} ${amount > 0 ? "+" : ""}${amount}`),
    ...Object.values(grant.items ?? {}).flat(),
  ]);
  const hasChoices = (entry.case.choices?.length ?? 0) > 0;
  return <div className={styles.grantSummary}>
    <p><strong>{rule.label}: {entry.case.equals}</strong></p>
    {lines.length > 0 && <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
    {entry.missing.length > 0 && <p className={styles.fieldError}>Falta escolher: {entry.missing.map((choice) => choice.label.toLowerCase()).join(", ")}.</p>}
    {hasChoices && <button type="button" className={styles.grantButton} disabled={busy} onClick={() => wizard.dialog.open(rule.id)}>{entry.missing.length ? "Escolher bônus" : "Alterar escolhas"}</button>}
  </div>;
}

/** Pacotes de clã e predador já escolhidos, com o botão para os bônus em aberto. */
export function GrantSummaries({ wizard, template, busy }: { wizard: SheetWizardState; template: SheetTemplate; busy: boolean }) {
  const rules = grantRules(template);
  if (!rules.some((rule) => wizard.grants.find((item) => item.rule.id === rule.id)?.case)) return null;
  return <div className={`${styles.wide} ${styles.grantList}`}>{rules.map((rule) => <GrantSummary key={rule.id} wizard={wizard} rule={rule} busy={busy} fieldLabels={wizard.fieldContext.fieldLabels} />)}</div>;
}

export function GrantDialog({ wizard, template, values, busy }: { wizard: SheetWizardState; template: SheetTemplate; values: Record<string, FieldValue>; busy: boolean }) {
  const { dialog } = wizard;
  return <dialog ref={dialog.ref} className={styles.grantDialog} aria-labelledby="grant-dialog-title" onClose={dialog.close}>
    {dialog.rule && dialog.selectedCase && <form method="dialog" onSubmit={dialog.close}>
      <h3 id="grant-dialog-title">{dialog.selectedCase.equals}: escolha os bônus</h3>
      <p className={styles.dialogIntro}>Os demais bônus já foram aplicados à ficha.</p>
      {(dialog.selectedCase.choices ?? []).map((choice) => {
        const choiceField = template.fields.find((item) => item.id === choice.field);
        const current = values[choice.field];
        return <fieldset className={styles.modeField} key={choice.field}>
          <legend>{choice.label}</legend>
          <div className={styles.choiceGrid}>
            {choiceOptions(choice, values).map((option) => <label className={`${styles.choice} ${current === option.label ? styles.choiceSelected : ""}`} key={option.label}>
              <input type="radio" name={`grant-${choice.field}`} checked={current === option.label} disabled={busy || !choiceField} onChange={() => choiceField && wizard.changeField(choiceField, option.label)} />
              <span>{option.label}</span>
            </label>)}
          </div>
        </fieldset>;
      })}
      <footer className={styles.actions}>
        <button type="submit" className={styles.next} disabled={busy}>{dialog.missing ? "Escolher depois" : "Confirmar"}</button>
      </footer>
    </form>}
  </dialog>;
}

/** Resumo final por etapa, com fórmulas calculadas e rolagens só como prévia. */
export function ReviewStep({ wizard, template, values, name, calculated }: { wizard: SheetWizardState; template: SheetTemplate; values: Record<string, FieldValue>; name: string; calculated: Record<string, unknown> }) {
  const active = template.fields.filter((field) => isFieldActive(template, field, values));
  return <div className={styles.review}>
    <div className={styles.reviewName}><span>PERSONAGEM</span><strong>{name.trim() || "Nome não informado"}</strong><small>{template.name}</small></div>
    {wizard.steps.filter((item) => item.kind === "identity" || item.kind === "group").map((item) => {
      const fields = item.fields.filter((field) => isFieldActive(template, field, values) && field.kind !== "formula" && field.kind !== "roll");
      if (!fields.length && item.kind !== "identity") return null;
      return <section className={styles.reviewGroup} key={item.key}><h4>{item.title}</h4>{item.kind === "identity" && wizard.identities.length === 0 ? <p>{name.trim()}</p> : null}{fields.map((field) => <p key={field.id}><span>{field.label}</span><strong>{formatValue(values[field.id])}</strong></p>)}</section>;
    })}
    {active.filter((field) => field.kind === "formula").map((field) => <section className={styles.reviewGroup} key={field.id}><h4>{field.label} · calculado</h4><p><span>{field.expression || "Fórmula do modelo"}</span><strong>{calculated[field.id] === undefined ? "Aguardando cálculo" : String(calculated[field.id])}</strong></p></section>)}
    {active.filter((field) => field.kind === "roll").map((field) => <section className={styles.reviewGroup} key={field.id}><h4>{field.label} · prévia</h4><p><span>{field.expression || "Expressão do modelo"}</span><strong>Sem rolagem</strong></p></section>)}
  </div>;
}

export function WizardPreview({ wizard, template, values, name, calculated }: { wizard: SheetWizardState; template: SheetTemplate; values: Record<string, FieldValue>; name: string; calculated: Record<string, unknown> }) {
  return <>
    <div className={styles.previewIdentity}><span>PERSONAGEM</span><strong>{name.trim() || "Sem nome"}</strong><small>{template.name || "Modelo"}</small></div>
    <div className={styles.previewFields}>
      {template.fields.filter((field) => isFieldActive(template, field, values) && field.id !== wizard.nameField?.id).map((field) => {
        let display: string;
        if (field.kind === "formula") display = calculated[field.id] === undefined ? "Aguardando cálculo" : String(calculated[field.id]);
        else if (field.kind === "roll") display = field.expression || "Expressão do modelo";
        else display = formatValue(values[field.id]);
        return <div className={styles.previewRow} key={field.id}><span>{field.label}<small>{field.kind === "formula" ? "Calculado" : field.kind === "roll" ? "Prévia, sem rolagem" : field.identity_kind ? "Identidade" : ""}</small></span><strong>{display}</strong></div>;
      })}
    </div>
  </>;
}
