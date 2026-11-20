"use client";

import type { ChangeEvent, ReactNode } from "react";

import { fieldOptions } from "../../../shared/rules/sheet-creation";
import type { FieldValue, PowerPicksRule, SheetField } from "../../../shared/rules/sheet-template";
import { collectionPointStatus, powerItem, powerStatus } from "../../../shared/rules/creation-grants";
import { specialtyRules, specialtyStatus } from "../../../shared/rules/creation-checks";
import { describeV5Power, v5PowerMetadata } from "../../../shared/rules/v5-creation-data";
import styles from "../sheet-creation-wizard.module.css";
import type { FieldContext } from "./use-sheet-wizard";
import { stringItems } from "./wizard-model";

type Props = { ctx: FieldContext; field: SheetField };

function ReadonlyField({ label, tag, children, outputId, note }: { label: string; tag: string; children: ReactNode; outputId?: string; note?: ReactNode }) {
  return <div className={`${styles.field} ${styles.readonly}`}><span className={styles.label}>{label}<span className={styles.readonlyTag}>{tag}</span></span><output id={outputId}>{children}</output>{note}</div>;
}

function PowerPicker({ ctx, field, rule }: Props & { rule: PowerPicksRule }) {
  const chosen = stringItems(ctx.values[field.id]);
  const statuses = powerStatus(rule, ctx.values).filter((status) => status.allowed > 0);
  // Nothing to pick (no sorcery for rituals, no clan yet): the list stays off the step.
  if (statuses.length === 0) return null;
  const toggle = (item: string, on: boolean) => ctx.changeField(field, on ? [...chosen, item] : chosen.filter((entry) => entry !== item));
  return <fieldset className={`${styles.powerPicker} ${styles.wide}`} id={`sheet-field-${field.id}`} tabIndex={-1}>
    <legend>{field.label}</legend>
    {statuses.map((status) => {
      const full = status.chosen.length >= status.allowed;
      return <section className={styles.powerGroup} key={status.source.field} aria-label={status.source.label}>
        <h4>{status.source.label} <span>{status.chosen.length} de {status.allowed} · até o nível {status.maxLevel}</span></h4>
        <div className={styles.powerList}>
          {status.available.map((power) => {
            const item = powerItem(status.source, power);
            const checked = chosen.includes(item);
            const meta = v5PowerMetadata(item);
            return <label className={`${styles.power} ${checked ? styles.powerChecked : ""}`} key={item}>
              <input type="checkbox" checked={checked} disabled={ctx.busy || (!checked && full)} onChange={(event) => toggle(item, event.target.checked)} />
              <span>{power.name}</span><small>{meta ? describeV5Power(meta) : `Nível ${power.level}`}</small>
            </label>;
          })}
        </div>
      </section>;
    })}
  </fieldset>;
}

/** Lista livre com itens travados pelo clã e predador, pontos de compra e especializações. */
function CollectionField({ ctx, field, common, label, errorNode }: Props & { common: Record<string, unknown>; label: ReactNode; errorNode: ReactNode }) {
  const { template, values, fieldLabels } = ctx;
  const locked = ctx.lockedItems.get(field.id) ?? [];
  const items = stringItems(values[field.id]).filter((item) => !locked.includes(item));
  const pointRule = ctx.pointRules.get(field.id);
  const points = pointRule ? collectionPointStatus(template, pointRule, values) : null;
  const specialtyRule = specialtyRules(template).find((rule) => rule.collection === field.id);
  const specialties = specialtyRule ? specialtyStatus(specialtyRule, values, locked) : null;
  const inputId = `sheet-field-${field.id}`;
  return <div className={styles.field}><label htmlFor={inputId}>{label}</label>
    {locked.length > 0 && <ul className={styles.lockedItems} aria-label={`${field.label} concedidas pelo clã e predador`}>{locked.map((item) => <li key={item}>{item}</li>)}</ul>}
    {pointRule && points && <small aria-live="polite">{points.spent} de {pointRule.points} pontos{pointRule.fields.length ? ` (inclui ${pointRule.fields.map((id) => fieldLabels.get(id) ?? id).join(", ")})` : ""}. Marque os pontos com • ou (2).</small>}
    {pointRule?.catalog?.length ? <details><summary>{pointRule.allow_homebrew ? "Catálogo do modelo (o narrador também aceita itens da casa)" : "Catálogo do modelo"}</summary>
      <small>{pointRule.catalog.map((entry) => `${entry.name} (${entry.costs.join("/")})`).join(" · ")}</small></details> : null}
    {specialtyRule && specialties && <small aria-live="polite">{specialties.own.length} de {specialties.expected} especializações gratuitas{specialties.due.length ? ` (uma em ${specialties.due.join(", ")}, mais ${specialtyRule.free} livre)` : ""}. Formato: Habilidade (especialização).</small>}
    <textarea {...common} rows={3} value={ctx.collectionDrafts[field.id] ?? items.join("\n")} placeholder={locked.length ? "Outros itens, um por linha" : "Um item por linha"} onChange={(event) => {
      const text = event.target.value;
      ctx.setCollectionDraft(field.id, text);
      ctx.changeField(field, [...locked, ...text.split("\n").map((item) => item.trim()).filter((item) => item && !locked.includes(item))]);
    }} />{errorNode}</div>;
}

/** Um campo do assistente no formato que o tipo e as regras do modelo pedem. */
export function WizardField({ ctx, field }: Props) {
  const { template, values, busy, errors, calculated, enforcedNumbers, changeField } = ctx;
  const value = values[field.id];
  const error = errors[field.id];
  const inputId = `sheet-field-${field.id}`;
  const dependencyHelpId = `${inputId}-dependency-help`;
  const controllingField = field.depends_on ? template.fields.find((candidate) => candidate.id === field.depends_on?.field_id) : undefined;
  const describedBy = [error ? `${inputId}-error` : "", controllingField ? dependencyHelpId : ""].filter(Boolean).join(" ") || undefined;
  const common = { id: inputId, "aria-invalid": Boolean(error), "aria-describedby": describedBy, disabled: busy };
  const errorNode = error ? <span className={styles.fieldError} id={`${inputId}-error`}>{error}</span> : null;
  const dependencyHelp = controllingField ? <small className={styles.dependencyHelp} id={dependencyHelpId}>Este campo depende da escolha em {controllingField.label}.</small> : null;
  const label = <span className={styles.label}>{field.label}{field.required && <span className={styles.required}>Obrigatório</span>}</span>;
  const change = (next: FieldValue) => changeField(field, next);

  if (field.kind === "formula") {
    return <ReadonlyField label={field.label} tag="Calculado" note={field.expression && <small>{field.expression}</small>}>{calculated[field.id] === undefined ? "Aguardando cálculo" : String(calculated[field.id])}</ReadonlyField>;
  }
  if (field.kind === "roll") {
    return <ReadonlyField label={field.label} tag="Prévia" note={<small>Os dados não são rolados durante a criação.</small>}>{field.expression || "Expressão definida no modelo"}</ReadonlyField>;
  }
  if (field.kind === "number" && enforcedNumbers.has(field.id)) {
    if (enforcedNumbers.get(field.id) === 0 && field.creation_step === "traits") return null; // disciplines the clan and predator leave at zero
    return <ReadonlyField label={field.label} tag="Definido pelo clã e predador" outputId={inputId}>{enforcedNumbers.get(field.id)}</ReadonlyField>;
  }
  const pickRule = field.kind === "collection" ? ctx.pickRules.get(field.id) : undefined;
  if (pickRule) return <PowerPicker ctx={ctx} field={field} rule={pickRule} />;
  if (ctx.masterGranted.has(field.id)) {
    return <ReadonlyField label={field.label} tag="Concedido pelo Mestre" note={<small>Começa em zero. O Mestre concede durante a crônica.</small>}>0</ReadonlyField>;
  }
  if (field.kind === "checkbox") {
    return <div className={styles.field}><label className={styles.checkRow} htmlFor={inputId}><input {...common} type="checkbox" checked={value === true} onChange={(event: ChangeEvent<HTMLInputElement>) => change(event.target.checked)} />{label}</label>{errorNode}</div>;
  }
  const options = fieldOptions(template, field, values);
  if (field.kind === "select" && field.identity_kind && options.length > 0) {
    const selected = typeof value === "string" ? value : "";
    return <fieldset className={styles.identityField} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
      <legend>{label}</legend><div className={styles.choiceGrid}>
        {options.map((option, index) => <label className={`${styles.choice} ${selected === option ? styles.choiceSelected : ""}`} key={option}>
          <input id={index === 0 ? inputId : undefined} type="radio" name={`identity-${field.id}`} value={option} checked={selected === option} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={() => change(option)} />
          <span>{option}</span>
        </label>)}
      </div>{dependencyHelp}{errorNode}
    </fieldset>;
  }
  if (field.kind === "select") {
    return <label className={styles.field}>{label}<select {...common} value={typeof value === "string" ? value : ""} onChange={(event) => change(event.target.value)}><option value="">Selecione</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>{dependencyHelp}{errorNode}</label>;
  }
  if (field.kind === "collection" && Array.isArray(field.item_options) && field.item_options.length) {
    // Closed list (for example O Um Anel favoured skills): checkboxes, capped by max_items.
    const chosen = stringItems(value);
    const full = typeof field.max_items === "number" && chosen.length >= field.max_items;
    return <fieldset className={`${styles.powerPicker} ${styles.wide}`} id={inputId} tabIndex={-1} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
      <legend>{label}{typeof field.max_items === "number" && <small> {chosen.length} de {field.max_items}</small>}</legend>
      <div className={styles.powerList}>{field.item_options.map((option) => {
        const checked = chosen.includes(option);
        return <label className={`${styles.power} ${checked ? styles.powerChecked : ""}`} key={option}>
          <input type="checkbox" checked={checked} disabled={busy || (!checked && full)} onChange={(event) => change(event.target.checked ? [...chosen, option] : chosen.filter((item) => item !== option))} />
          <span>{option}</span>
        </label>;
      })}</div>{errorNode}
    </fieldset>;
  }
  if (field.kind === "collection") return <CollectionField ctx={ctx} field={field} common={common} label={label} errorNode={errorNode} />;
  return <label className={styles.field}>{label}<input {...common} type={field.kind === "number" ? "number" : "text"} maxLength={field.kind === "text" ? field.max_length ?? undefined : undefined} min={field.kind === "number" ? field.min ?? undefined : undefined} max={field.kind === "number" ? field.max ?? undefined : undefined} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={(event) => change(field.kind === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />{errorNode}</label>;
}
