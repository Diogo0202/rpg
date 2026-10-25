"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { characterNameField, creationGroups, creationStepLabel, distributionRulesFor, fieldOptions, identityFields, isFieldActive, masterGrantedFieldIds, matchingDistribution, reconcileDependentValues, tallyDistribution, validateFields, type DistributionRule, type DistributionTally } from "../lib/sheet-creation";
import type { CreationDistribution, FieldValue, SheetField, SheetTemplate, StoredTemplate } from "../lib/sheet-template";
import styles from "./sheet-creation-wizard.module.css";
import { AiSheetRequest } from "./ai-assistance-panel";
import { PortraitPicker } from "./portrait-picker";
import { HUNTER_STEP_HELP } from "../lib/hunter-creation-data";
import { checkCreation, type CreationReport } from "../lib/sheet-adjustments";
import { activeGrants, applyGrants, choiceOptions, grantChoiceFieldIds, grantedItems, grantedNumbers, grantProblems, grantRules, powerItem, powerRules, powerStatus, selectedCase } from "../lib/creation-grants";
import type { PowerPicksRule, SelectGrantsRule } from "../lib/sheet-template";
import { lockedFieldIds, priorityPatch, priorityRules, tallyPriority, type PoolTally, type PriorityTally } from "../lib/priority-points";

type Props = {
  campaignId: string;
  templates: StoredTemplate[];
  templateId: string;
  template: SheetTemplate;
  values: Record<string, FieldValue>;
  name: string;
  calculated: Record<string, unknown>;
  busy: boolean;
  canCreate: boolean;
  /** Campaign managers may set XP and pool currencies at creation; players start them at zero. */
  canGrantResources: boolean;
  loading: boolean;
  loadError: string;
  feedback: string;
  calculationError: string;
  onChooseTemplate: (id: string) => void;
  onNameChange: (name: string) => void;
  onValueChange: (id: string, value: FieldValue | undefined) => void;
  onSave: () => Promise<void>;
  onOpenEditor?: () => void;
  viewerId: string;
  portraitPath: string | null;
  onPortraitChange: (path: string) => void;
};

type WizardStep = { key: string; title: string; fields: SheetField[]; kind: "template" | "identity" | "group" | "portrait" | "review" };

export function SheetCreationWizard(props: Props) {
  const {
    campaignId, templates, templateId, template, values, name, calculated, busy, canCreate, canGrantResources, loading,
    loadError, feedback, calculationError, onChooseTemplate, onNameChange, onValueChange,
    onSave, onOpenEditor, viewerId, portraitPath, onPortraitChange,
  } = props;
  const masterGranted = useMemo(() => canGrantResources ? new Set<string>() : masterGrantedFieldIds(template), [canGrantResources, template]);

  // A player's sheet starts with master-granted resources at zero, or the database refuses it.
  useEffect(() => {
    for (const id of masterGranted) if (typeof values[id] === "number" && values[id] !== 0) onValueChange(id, 0);
  }, [masterGranted]); // eslint-disable-line react-hooks/exhaustive-deps
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [collectionDrafts, setCollectionDrafts] = useState<Record<string, string>>({});
  const [dependencyAnnouncement, setDependencyAnnouncement] = useState("");
  const [report, setReport] = useState<CreationReport | null>(null);
  const [reportError, setReportError] = useState("");
  const valuesKey = JSON.stringify(values);

  // The backend is the source of truth for limits and creation rules; ask it as the draft changes.
  useEffect(() => {
    if (!templateId || !canCreate) { setReport(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkCreation(campaignId, templateId, values, controller.signal)
        .then((next) => { if (!controller.signal.aborted) { setReport(next); setReportError(""); } })
        .catch((problem) => { if (!controller.signal.aborted) { setReport(null); setReportError(problem instanceof Error ? problem.message : "Não foi possível conferir as regras."); } });
    }, 400);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [campaignId, templateId, canCreate, valuesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Priority rules (Vampire V3): fields the chosen clan does not open stay out of the steps, and a board counts the points.
  const lockedPriority = useMemo(() => lockedFieldIds(template, values), [template, values]);
  const priorityTallies = useMemo(() => priorityRules(template).map((rule) => tallyPriority(template, rule, values)), [template, values]);
  const groups = useMemo(() => creationGroups(template).map((group) => ({
    ...group,
    fields: group.fields.filter((field) => isFieldActive(template, field, values) && !lockedPriority.has(field.id)),
  })).filter((group) => group.fields.length > 0), [template, values, lockedPriority]);
  const nameField = characterNameField(template);
  const choiceFieldIds = useMemo(() => grantChoiceFieldIds(template), [template]);
  const identities = useMemo(() => identityFields(template).filter((field) => !choiceFieldIds.has(field.id) && isFieldActive(template, field, values)), [template, values, choiceFieldIds]);
  const grants = useMemo(() => activeGrants(template, values), [template, values]);
  const enforcedNumbers = useMemo(() => grantedNumbers(template, values).enforced, [template, values]);
  const lockedItems = useMemo(() => grantedItems(template, values), [template, values]);
  const pickRules = useMemo(() => new Map(powerRules(template).map((rule) => [rule.collection, rule])), [template]);
  const fieldLabels = useMemo(() => new Map(template.fields.map((field) => [field.id, field.label])), [template]);
  const [grantDialog, setGrantDialog] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (grantDialog && !dialog.open) dialog.showModal();
    if (!grantDialog && dialog.open) dialog.close();
  }, [grantDialog]);
  const steps: WizardStep[] = [
    { key: "template", title: "Modelo", fields: [], kind: "template" },
    { key: "identity", title: "Nome e identidade", fields: identities, kind: "identity" },
    ...groups.map((group) => ({ key: group.step, title: creationStepLabel(group.step), fields: group.fields, kind: "group" as const })),
    { key: "portrait", title: "Retrato", fields: [], kind: "portrait" },
    { key: "review", title: "Revisão", fields: [], kind: "review" },
  ];
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = step.kind === "review";
  const stepFieldIds = new Set(step.fields.map((field) => field.id));
  const stepViolations = (report?.violations ?? []).filter((violation) => isLast || violation.fields.some((id) => stepFieldIds.has(id)));
  const rulesBlockFinish = report !== null && !report.valid;

  // Distribution modes chosen per rule; a draft that already fits a mode opens on it.
  const [chosenOptions, setChosenOptions] = useState<Record<string, number>>({});
  const stepRules = step.kind === "group" ? distributionRulesFor(template, stepFieldIds) : [];
  function chosenOption(rule: DistributionRule): number {
    if (rule.options.length === 1) return 0;
    return chosenOptions[rule.id] ?? matchingDistribution(rule, values);
  }
  const stepPools = step.kind === "group"
    ? priorityTallies.flatMap((tally) => tally.pools.filter((pool) => pool.pool.groups.some((group) => group.fields.some((id) => stepFieldIds.has(id)))).map((pool) => ({ tally, pool })))
    : [];
  const priorityOpen = priorityTallies.filter((tally) => !tally.complete);
  const pendingModeRules = stepRules.filter((rule) => chosenOption(rule) < 0);
  const hiddenFieldIds = new Set(pendingModeRules.flatMap((rule) => rule.fields));
  const tallies = stepRules.filter((rule) => chosenOption(rule) >= 0)
    .map((rule) => ({ rule, option: rule.options[chosenOption(rule)], tally: tallyDistribution(rule, rule.options[chosenOption(rule)], values) }));

  function chooseOption(rule: DistributionRule, index: number) {
    if (busy) return;
    setChosenOptions((current) => ({ ...current, [rule.id]: index }));
    clearError("$rules");
  }

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function changeField(field: SheetField, value: FieldValue) {
    if (busy) return;
    const reconciled = reconcileDependentValues(template, { ...values, [field.id]: value });
    onValueChange(field.id, value);
    for (const id of reconciled.removedIds) onValueChange(id, undefined);
    // Clan and predator packages land on the sheet at once; the picks they offer open in a dialog.
    const granted = applyGrants(template, values, reconciled.values);
    for (const [id, next] of Object.entries(granted)) onValueChange(id, next);
    // Fields whose base follows other fields keep what was bought above it; locked ones fall back to base.
    const priority = priorityPatch(template, values, { ...reconciled.values, ...granted });
    for (const [id, next] of Object.entries(priority)) onValueChange(id, next);
    const opened = grantRules(template).find((rule) => rule.field === field.id && (selectedCase(rule, reconciled.values)?.choices?.length ?? 0) > 0);
    if (opened) setGrantDialog(opened.id);
    clearError(field.id);
    clearError("$rules");
    if (reconciled.removedIds.length) {
      setErrors((current) => {
        const next = { ...current };
        for (const id of reconciled.removedIds) delete next[id];
        return next;
      });
      setCollectionDrafts((current) => {
        const next = { ...current };
        for (const id of reconciled.removedIds) delete next[id];
        return next;
      });
      setDependencyAnnouncement("Os campos dependentes foram atualizados conforme a escolha controladora.");
    } else setDependencyAnnouncement("");
  }

  function advance() {
    if (busy) return;
    const nextErrors = { ...validateFields(step.fields, values, template) };
    if (step.kind === "identity") {
      if (!name.trim()) nextErrors.$name = "Informe o nome do personagem.";
      else if (name.trim().length > 120) nextErrors.$name = "O nome deve ter até 120 caracteres.";
    }
    if (step.kind === "portrait" && !portraitPath) nextErrors.$portrait = "Envie uma foto do personagem para continuar.";
    if (step.kind === "group" || step.kind === "identity") {
      const local = [
        ...pendingModeRules.map((rule) => `Escolha um modo de ${rule.label}.`),
        ...tallies.filter(({ tally }) => !tally.complete).map(({ rule, tally }) => `${rule.label}: ${describeMissing(tally)}`),
        ...grantProblems(template, values, stepFieldIds, fieldLabels),
        ...stepPools.flatMap(({ tally, pool }) => [
          ...pool.problems,
          ...(pool.shortfall ? [`${pool.pool.label}: faltam ${pool.shortfall} ${pool.shortfall === 1 ? "ponto" : "pontos"} da distribuição inicial.`] : []),
          ...(tally.remaining < 0 ? [`Bônus: ${-tally.remaining} a mais que os ${tally.rule.freebies} disponíveis.`] : []),
        ]),
      ];
      const messages = local.length ? local : stepViolations.map((violation) => violation.message);
      if (messages.length) nextErrors.$rules = messages.join(" ");
    }
    setErrors(nextErrors);
    if (step.kind === "group" && pendingModeRules.length) { document.getElementById(`sheet-mode-${pendingModeRules[0].id}`)?.focus(); return; }
    if (nextErrors.$rules && Object.keys(nextErrors).length === 1) { document.getElementById("sheet-rules")?.focus(); return; }
    const firstInvalid = step.kind === "identity" && nextErrors.$name ? "$name" : Object.keys(nextErrors)[0];
    if (firstInvalid) {
      document.getElementById(firstInvalid === "$name" ? "sheet-character-name" : `sheet-field-${firstInvalid}`)?.focus();
      return;
    }
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  function back() {
    if (!busy) setStepIndex((index) => Math.max(0, index - 1));
  }

  function setName(next: string) {
    if (busy) return;
    onNameChange(next);
    clearError("$name");
    if (nameField) clearError(nameField.id);
  }

  function renderField(field: SheetField): ReactNode {
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

    if (field.kind === "formula") {
      return <div className={`${styles.field} ${styles.readonly}`} key={field.id}><span className={styles.label}>{field.label}<span className={styles.readonlyTag}>Calculado</span></span><output>{calculated[field.id] === undefined ? "Aguardando cálculo" : String(calculated[field.id])}</output>{field.expression && <small>{field.expression}</small>}</div>;
    }
    if (field.kind === "roll") {
      return <div className={`${styles.field} ${styles.readonly}`} key={field.id}><span className={styles.label}>{field.label}<span className={styles.readonlyTag}>Prévia</span></span><output>{field.expression || "Expressão definida no modelo"}</output><small>Os dados não são rolados durante a criação.</small></div>;
    }
    if (field.kind === "number" && enforcedNumbers.has(field.id)) {
      if (enforcedNumbers.get(field.id) === 0 && field.creation_step === "traits") return null;  // disciplines the clan and predator leave at zero
      return <div className={`${styles.field} ${styles.readonly}`} key={field.id}><span className={styles.label}>{field.label}<span className={styles.readonlyTag}>Definido pelo clã e predador</span></span><output id={inputId}>{enforcedNumbers.get(field.id)}</output></div>;
    }
    const pickRule = field.kind === "collection" ? pickRules.get(field.id) : undefined;
    if (pickRule) return renderPowerPicker(field, pickRule);
    if (masterGranted.has(field.id)) {
      return <div className={`${styles.field} ${styles.readonly}`} key={field.id}><span className={styles.label}>{field.label}<span className={styles.readonlyTag}>Concedido pelo Mestre</span></span><output>0</output><small>Começa em zero. O Mestre concede durante a crônica.</small></div>;
    }
    if (field.kind === "checkbox") {
      return <div className={styles.field} key={field.id}><label className={styles.checkRow} htmlFor={inputId}><input {...common} type="checkbox" checked={value === true} onChange={(event: ChangeEvent<HTMLInputElement>) => changeField(field, event.target.checked)} />{label}</label>{errorNode}</div>;
    }
    const options = fieldOptions(template, field, values);
    if (field.kind === "select" && field.identity_kind && options.length > 0) {
      const selected = typeof value === "string" ? value : "";
      return <fieldset className={styles.identityField} key={field.id} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
        <legend>{label}</legend><div className={styles.choiceGrid}>
          {options.map((option, index) => <label className={`${styles.choice} ${selected === option ? styles.choiceSelected : ""}`} key={option}>
            <input id={index === 0 ? inputId : undefined} type="radio" name={`identity-${field.id}`} value={option} checked={selected === option} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={describedBy} onChange={() => changeField(field, option)} />
            <span>{option}</span>
          </label>)}
        </div>{dependencyHelp}{errorNode}
      </fieldset>;
    }
    if (field.kind === "select") {
      return <label className={styles.field} key={field.id}>{label}<select {...common} value={typeof value === "string" ? value : ""} onChange={(event) => changeField(field, event.target.value)}><option value="">Selecione</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select>{dependencyHelp}{errorNode}</label>;
    }
    if (field.kind === "collection") {
      // Items a clan or predator grants stay on the list; the player edits only the rest.
      const locked = lockedItems.get(field.id) ?? [];
      const items = (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []).filter((item) => !locked.includes(item));
      return <div className={styles.field} key={field.id}><label htmlFor={inputId}>{label}</label>
        {locked.length > 0 && <ul className={styles.lockedItems} aria-label={`${field.label} concedidas pelo clã e predador`}>{locked.map((item) => <li key={item}>{item}</li>)}</ul>}
        <textarea {...common} rows={3} value={collectionDrafts[field.id] ?? items.join("\n")} placeholder={locked.length ? "Outros itens, um por linha" : "Um item por linha"} onChange={(event) => {
          const text = event.target.value;
          setCollectionDrafts((current) => ({ ...current, [field.id]: text }));
          changeField(field, [...locked, ...text.split("\n").map((item) => item.trim()).filter((item) => item && !locked.includes(item))]);
        }} />{errorNode}</div>;
    }
    return <label className={styles.field} key={field.id}>{label}<input {...common} type={field.kind === "number" ? "number" : "text"} min={field.kind === "number" ? field.min ?? undefined : undefined} max={field.kind === "number" ? field.max ?? undefined : undefined} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={(event) => changeField(field, field.kind === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />{errorNode}</label>;
  }

  function renderPowerPicker(field: SheetField, rule: PowerPicksRule): ReactNode {
    const chosen = Array.isArray(values[field.id]) ? (values[field.id] as FieldValue[]).filter((item): item is string => typeof item === "string") : [];
    const statuses = powerStatus(rule, values).filter((status) => status.allowed > 0);
    function toggle(item: string, on: boolean) {
      changeField(field, on ? [...chosen, item] : chosen.filter((entry) => entry !== item));
    }
    // Nothing to pick (no sorcery for rituals, no clan yet): the list stays off the step.
    if (statuses.length === 0) return null;
    return <fieldset className={`${styles.powerPicker} ${styles.wide}`} key={field.id} id={`sheet-field-${field.id}`} tabIndex={-1}>
      <legend>{field.label}</legend>
      {statuses.map((status) => {
        const full = status.chosen.length >= status.allowed;
        return <section className={styles.powerGroup} key={status.source.field} aria-label={status.source.label}>
          <h4>{status.source.label} <span>{status.chosen.length} de {status.allowed} · até o nível {status.maxLevel}</span></h4>
          <div className={styles.powerList}>
            {status.available.map((power) => {
              const item = powerItem(status.source, power);
              const checked = chosen.includes(item);
              return <label className={`${styles.power} ${checked ? styles.powerChecked : ""}`} key={item}>
                <input type="checkbox" checked={checked} disabled={busy || (!checked && full)} onChange={(event) => toggle(item, event.target.checked)} />
                <span>{power.name}</span><small>Nível {power.level}</small>
              </label>;
            })}
          </div>
        </section>;
      })}
    </fieldset>;
  }

  function grantSummary(rule: SelectGrantsRule) {
    const entry = grants.find((item) => item.rule.id === rule.id);
    if (!entry?.case) return null;
    const lines = entry.grants.flatMap((grant) => [
      ...Object.entries(grant.add ?? {}).map(([id, amount]) => `${fieldLabels.get(id) ?? id} ${amount > 0 ? "+" : ""}${amount}`),
      ...Object.values(grant.items ?? {}).flat(),
    ]);
    const hasChoices = (entry.case.choices?.length ?? 0) > 0;
    return <div className={styles.grantSummary} key={rule.id}>
      <p><strong>{rule.label}: {entry.case.equals}</strong></p>
      {lines.length > 0 && <ul>{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
      {entry.missing.length > 0 && <p className={styles.fieldError}>Falta escolher: {entry.missing.map((choice) => choice.label.toLowerCase()).join(", ")}.</p>}
      {hasChoices && <button type="button" className={styles.grantButton} disabled={busy} onClick={() => setGrantDialog(rule.id)}>{entry.missing.length ? "Escolher bônus" : "Alterar escolhas"}</button>}
    </div>;
  }

  const dialogRule = grantRules(template).find((rule) => rule.id === grantDialog);
  const dialogCase = dialogRule ? selectedCase(dialogRule, values) : undefined;
  const dialogMissing = dialogRule ? grants.find((item) => item.rule.id === dialogRule.id)?.missing.length ?? 0 : 0;

  const identityFieldErrors = errors;
  const previewContent = <>
    <div className={styles.previewIdentity}><span>PERSONAGEM</span><strong>{name.trim() || "Sem nome"}</strong><small>{template.name || "Modelo"}</small></div>
    <div className={styles.previewFields}>
      {template.fields.filter((field) => isFieldActive(template, field, values)).map((field) => {
        if (field.id === nameField?.id) return null;
        let display: string;
        if (field.kind === "formula") display = calculated[field.id] === undefined ? "Aguardando cálculo" : String(calculated[field.id]);
        else if (field.kind === "roll") display = field.expression || "Expressão do modelo";
        else display = formatValue(values[field.id]);
        return <div className={styles.previewRow} key={field.id}><span>{field.label}<small>{field.kind === "formula" ? "Calculado" : field.kind === "roll" ? "Prévia, sem rolagem" : field.identity_kind ? "Identidade" : ""}</small></span><strong>{display}</strong></div>;
      })}
    </div>
  </>;
  return <section className={styles.wizard} aria-labelledby="sheet-wizard-title">
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>NOVA FICHA</p><h2 id="sheet-wizard-title">Crie seu personagem</h2><p className={styles.intro}>Escolha um modelo, preencha a ficha e leve o personagem para a mesa.</p></div>
      {onOpenEditor && <button className={styles.editorLink} type="button" disabled={busy} onClick={onOpenEditor}>Abrir editor de modelos</button>}
    </header>

    <nav className={styles.progress} aria-label="Etapas da criação">
      {steps.map((item, index) => <div className={`${styles.progressItem} ${index === stepIndex ? styles.progressCurrent : ""} ${index < stepIndex ? styles.progressDone : ""}`} key={item.key} aria-current={index === stepIndex ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span><small>{item.title}</small></div>)}
    </nav>

    {loadError && <p className={styles.noticeError} role="alert">{loadError}</p>}
    {feedback && <p className={styles.notice} aria-live="polite">{feedback}</p>}
    {calculationError && <p className={styles.noticeError} role="alert">{calculationError}</p>}

    <article className={styles.card}>
      <div className={styles.stepHeading}><span className={styles.stepNumber}>{String(stepIndex + 1).padStart(2, "0")}</span><div><p className={styles.eyebrow}>ETAPA {stepIndex + 1} DE {steps.length}</p><h3>{step.title}</h3></div></div>
      {template.system_key === "hunter" && HUNTER_STEP_HELP[step.key] && <p className={styles.intro}>{HUNTER_STEP_HELP[step.key]}</p>}

      {loading ? <p className={styles.empty}>Carregando modelos da campanha…</p> : null}
      {!loading && step.kind === "template" && <div className={styles.templateGrid}>
        {templates.map((item) => <button key={item.id} type="button" className={`${styles.templateChoice} ${templateId === item.id ? styles.templateSelected : ""}`} aria-pressed={templateId === item.id} disabled={busy} onClick={() => onChooseTemplate(item.id)}><span className={styles.templateMark}>✦</span><span><strong>{item.name}</strong><small>Versão {item.version} · {item.schema.fields.length} campos</small></span><span className={styles.templateArrow}>›</span></button>)}
        {templates.length === 0 && !loadError && <p className={styles.empty}>Ainda não há modelos publicados nesta campanha.</p>}
      </div>}

      {step.kind === "identity" && <div className={styles.fieldGrid}>
        <label className={`${styles.field} ${styles.wide}`} htmlFor="sheet-character-name"><span className={styles.label}>Nome do personagem<span className={styles.required}>Obrigatório</span></span><input id="sheet-character-name" maxLength={120} value={name} disabled={busy} aria-invalid={Boolean(identityFieldErrors.$name)} aria-describedby={identityFieldErrors.$name ? "sheet-character-name-error" : undefined} placeholder="Como a mesa vai chamar seu personagem?" onChange={(event) => setName(event.target.value)} />{identityFieldErrors.$name && <span className={styles.fieldError} id="sheet-character-name-error">{identityFieldErrors.$name}</span>}</label>
        {identities.map(renderField)}
        {grantRules(template).some((rule) => grants.find((item) => item.rule.id === rule.id)?.case) && <div className={`${styles.wide} ${styles.grantList}`}>{grantRules(template).map(grantSummary)}</div>}
      </div>}

      {step.kind === "group" && stepRules.map((rule) => {
        const selected = chosenOption(rule);
        const entry = tallies.find((item) => item.rule.id === rule.id);
        return <div className={styles.distribution} key={rule.id}>
          {rule.options.length > 1 && <fieldset className={styles.modeField}>
            <legend>Escolha o modo de {rule.label.toLowerCase()}</legend>
            <div className={styles.modeGrid}>
              {rule.options.map((option, index) => <label className={`${styles.modeCard} ${selected === index ? styles.modeSelected : ""}`} key={option.label}>
                <input id={index === 0 ? `sheet-mode-${rule.id}` : undefined} type="radio" name={`mode-${rule.id}`} checked={selected === index} disabled={busy} onChange={() => chooseOption(rule, index)} />
                <strong>{option.label}</strong>
                <DistributionDots option={option} size={rule.fields.length} />
                <small>{describeOption(option, rule.fields.length)}</small>
              </label>)}
            </div>
          </fieldset>}
          {entry ? <DistributionCounter label={rule.label} tally={entry.tally} /> : <p className={styles.modeHint}>Escolha um modo para distribuir os pontos de {rule.label.toLowerCase()}.</p>}
        </div>;
      })}

      {step.kind === "group" && priorityTallies.map((tally) => {
        const pools = stepPools.filter((item) => item.tally === tally).map((item) => item.pool);
        return pools.length ? <PriorityBoard key={tally.rule.id} tally={tally} pools={pools} /> : null;
      })}

      {step.kind === "group" && <div className={styles.fieldGrid}>{step.fields.filter((field) => !hiddenFieldIds.has(field.id)).map(renderField)}</div>}

      {isLast && priorityOpen.length > 0 && <div className={styles.rules} role="status" aria-live="polite">
        <strong>Falta distribuir pontos</strong>
        <ul>{priorityOpen.flatMap((tally) => tally.problems.map((problem) => <li key={`${tally.rule.id}-${problem}`}>{problem}</li>))}</ul>
      </div>}

      {(step.kind === "group" || step.kind === "identity" || isLast) && (stepViolations.length > 0 || (step.kind !== "review" && errors.$rules) || (isLast && (report?.field_errors.length ?? 0) > 0) || reportError) &&
        <div id="sheet-rules" tabIndex={-1} className={styles.rules} role="status" aria-live="polite">
          <strong>{reportError ? "Regras não conferidas" : "Regras de criação"}</strong>
          {reportError ? <p>{reportError} O servidor confere de novo ao salvar.</p> : <ul>
            {stepViolations.length === 0 && errors.$rules && <li>{errors.$rules}</li>}
            {stepViolations.map((violation) => <li key={violation.rule_id}>{violation.message}</li>)}
            {isLast && report?.field_errors.map((error) => <li key={error}>{error}</li>)}
          </ul>}
        </div>}

      {step.kind === "portrait" && <PortraitPicker campaignId={campaignId} uploaderId={viewerId} value={portraitPath} name={name}
        disabled={busy} error={errors.$portrait} onChange={(path) => { onPortraitChange(path); clearError("$portrait"); }} />}

      {step.kind === "review" && <div className={styles.review}>
        <div className={styles.reviewName}><span>PERSONAGEM</span><strong>{name.trim() || "Nome não informado"}</strong><small>{template.name}</small></div>
        {steps.filter((item) => item.kind === "identity" || item.kind === "group").map((item) => {
          const fields = item.fields.filter((field) => isFieldActive(template, field, values) && field.kind !== "formula" && field.kind !== "roll");
          if (!fields.length && item.kind !== "identity") return null;
          return <section className={styles.reviewGroup} key={item.key}><h4>{item.title}</h4>{item.kind === "identity" && identities.length === 0 ? <p>{name.trim()}</p> : null}{fields.map((field) => <p key={field.id}><span>{field.label}</span><strong>{formatValue(values[field.id])}</strong></p>)}</section>;
        })}
        {template.fields.filter((field) => isFieldActive(template, field, values) && field.kind === "formula").map((field) => <section className={styles.reviewGroup} key={field.id}><h4>{field.label} · calculado</h4><p><span>{field.expression || "Fórmula do modelo"}</span><strong>{calculated[field.id] === undefined ? "Aguardando cálculo" : String(calculated[field.id])}</strong></p></section>)}
        {template.fields.filter((field) => isFieldActive(template, field, values) && field.kind === "roll").map((field) => <section className={styles.reviewGroup} key={field.id}><h4>{field.label} · prévia</h4><p><span>{field.expression || "Expressão do modelo"}</span><strong>Sem rolagem</strong></p></section>)}
      </div>}

      <footer className={styles.actions}>
        <button type="button" className={styles.back} disabled={busy || stepIndex === 0} onClick={back}>Voltar</button>
        {isLast ? <button type="button" className={styles.finish} disabled={busy || !canCreate || !templateId || !name.trim() || !portraitPath || rulesBlockFinish || priorityOpen.length > 0} onClick={() => void onSave()}>{busy ? "Salvando…" : "Concluir e importar para a mesa"}</button> : <button type="button" className={styles.next} disabled={busy || (step.kind === "template" && (!templateId || loading))} onClick={advance}>Continuar <span aria-hidden="true">→</span></button>}
      </footer>
      {!canCreate && isLast && <p className={styles.permissionHint}>Seu papel nesta campanha não permite criar fichas.</p>}
    </article>
    <dialog ref={dialogRef} className={styles.grantDialog} aria-labelledby="grant-dialog-title" onClose={() => setGrantDialog(null)}>
      {dialogRule && dialogCase && <form method="dialog" onSubmit={() => setGrantDialog(null)}>
        <h3 id="grant-dialog-title">{dialogCase.equals}: escolha os bônus</h3>
        <p className={styles.dialogIntro}>Os demais bônus já foram aplicados à ficha.</p>
        {(dialogCase.choices ?? []).map((choice) => {
          const choiceField = template.fields.find((item) => item.id === choice.field);
          const current = values[choice.field];
          return <fieldset className={styles.modeField} key={choice.field}>
            <legend>{choice.label}</legend>
            <div className={styles.choiceGrid}>
              {choiceOptions(choice, values).map((option) => <label className={`${styles.choice} ${current === option.label ? styles.choiceSelected : ""}`} key={option.label}>
                <input type="radio" name={`grant-${choice.field}`} checked={current === option.label} disabled={busy || !choiceField} onChange={() => choiceField && changeField(choiceField, option.label)} />
                <span>{option.label}</span>
              </label>)}
            </div>
          </fieldset>;
        })}
        <footer className={styles.actions}>
          <button type="submit" className={styles.next} disabled={busy}>{dialogMissing ? "Escolher depois" : "Confirmar"}</button>
        </footer>
      </form>}
    </dialog>
    <p className={styles.visuallyHidden} role="status" aria-live="polite">{dependencyAnnouncement}</p>
    <aside className={styles.desktopPreview} aria-label="Prévia da ficha"><p className={styles.eyebrow}>PRÉVIA DA MESA</p>{previewContent}<small>Os resultados são atualizados ao preencher a ficha. Dados só são rolados na sessão.</small></aside>
    <details className={styles.mobilePreview}><summary>Ver prévia da ficha</summary>{previewContent}</details>
    {templateId && canCreate && <AiSheetRequest campaignId={campaignId} templateId={templateId} />}
  </section>;
}

function slotsOf(option: CreationDistribution, size: number): Array<[number, number]> {
  const rest = option.rest ?? 0;
  const slots = Object.entries(option.counts).map(([value, count]) => [Number(value), count] as [number, number]).filter(([, count]) => count > 0).sort(([a], [b]) => b - a);
  const left = size - slots.reduce((sum, [, count]) => sum + count, 0);
  return left > 0 ? [...slots, [rest, left]] : slots;
}

function describeOption(option: CreationDistribution, size: number): string {
  return slotsOf(option, size).map(([value, count]) => `${count} em ${value}`).join(" · ");
}

/** One column per value, one dot per point: shows the shape of a mode at a glance. */
function DistributionDots({ option, size }: { option: CreationDistribution; size: number }) {
  return <span className={styles.modeShape} aria-hidden="true">
    {slotsOf(option, size).filter(([value]) => value > 0).map(([value, count]) => <span className={styles.modeColumn} key={value}>
      <span className={styles.modeDots}>{Array.from({ length: value }, (_, index) => <i key={index} />)}</span>
      <b>×{count}</b>
    </span>)}
  </span>;
}

/** Extra fields at the lowest value are just points not yet placed, not a mistake. */
function isOver(tally: DistributionTally, slot: DistributionTally["slots"][number]): boolean {
  return slot.have > slot.need && slot.value > Math.min(...tally.slots.map((item) => item.value));
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
function PriorityBoard({ tally, pools }: { tally: PriorityTally; pools: PoolTally[] }) {
  const over = tally.remaining < 0;
  return <div className={`${styles.tally} ${styles.priorityBoard} ${tally.remaining === 0 && !over ? styles.tallyComplete : ""}`} role="status" aria-live="polite">
    <p className={styles.tallyStatus}>
      {over ? `Bônus: ${-tally.remaining} a mais que os ${tally.rule.freebies} disponíveis.` : `Pontos de bônus: restam ${tally.remaining} de ${tally.rule.freebies}.`}
    </p>
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

function describeMissing(tally: DistributionTally): string {
  const parts = tally.slots.filter((slot) => slot.have < slot.need || isOver(tally, slot)).map((slot) => slot.have < slot.need
    ? `falta${slot.need - slot.have > 1 ? "m" : ""} ${slot.need - slot.have} em ${slot.value}`
    : `${slot.have - slot.need} a mais em ${slot.value}`);
  if (tally.outside.length) parts.push(`${tally.outside.length} fora da tabela`);
  return parts.length ? `${parts.join(", ")}.` : "confira os valores.";
}

function formatValue(value: FieldValue | undefined): string {
  if (value === undefined || value === "") return "Não informado";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}
