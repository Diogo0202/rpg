"use client";

import { useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { characterNameField, creationGroups, creationStepLabel, fieldOptions, identityFields, isFieldActive, reconcileDependentValues, validateFields } from "../lib/sheet-creation";
import type { FieldValue, SheetField, SheetTemplate, StoredTemplate } from "../lib/sheet-template";
import styles from "./sheet-creation-wizard.module.css";
import { AiSheetRequest } from "./ai-assistance-panel";

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
  loading: boolean;
  loadError: string;
  feedback: string;
  calculationError: string;
  onChooseTemplate: (id: string) => void;
  onNameChange: (name: string) => void;
  onValueChange: (id: string, value: FieldValue | undefined) => void;
  onSave: () => Promise<void>;
  onOpenEditor?: () => void;
};

type WizardStep = { key: string; title: string; fields: SheetField[]; kind: "template" | "identity" | "group" | "review" };

export function SheetCreationWizard(props: Props) {
  const {
    campaignId, templates, templateId, template, values, name, calculated, busy, canCreate, loading,
    loadError, feedback, calculationError, onChooseTemplate, onNameChange, onValueChange,
    onSave, onOpenEditor,
  } = props;
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [collectionDrafts, setCollectionDrafts] = useState<Record<string, string>>({});
  const [dependencyAnnouncement, setDependencyAnnouncement] = useState("");
  const groups = useMemo(() => creationGroups(template).map((group) => ({
    ...group,
    fields: group.fields.filter((field) => isFieldActive(template, field, values)),
  })).filter((group) => group.fields.length > 0), [template, values]);
  const nameField = characterNameField(template);
  const identities = useMemo(() => identityFields(template).filter((field) => isFieldActive(template, field, values)), [template, values]);
  const steps: WizardStep[] = [
    { key: "template", title: "Modelo", fields: [], kind: "template" },
    { key: "identity", title: "Nome e identidade", fields: identities, kind: "identity" },
    ...groups.map((group) => ({ key: group.step, title: creationStepLabel(group.step), fields: group.fields, kind: "group" as const })),
    { key: "review", title: "Revisão", fields: [], kind: "review" },
  ];
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = step.kind === "review";

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
    clearError(field.id);
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
    setErrors(nextErrors);
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
      const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      return <div className={styles.field} key={field.id}><label htmlFor={inputId}>{label}</label><textarea {...common} rows={3} value={collectionDrafts[field.id] ?? items.join("\n")} placeholder="Um item por linha" onChange={(event) => {
        const text = event.target.value;
        setCollectionDrafts((current) => ({ ...current, [field.id]: text }));
        changeField(field, text.split("\n").map((item) => item.trim()).filter(Boolean));
      }} />{errorNode}</div>;
    }
    return <label className={styles.field} key={field.id}>{label}<input {...common} type={field.kind === "number" ? "number" : "text"} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={(event) => changeField(field, field.kind === "number" ? event.target.value === "" ? "" : Number(event.target.value) : event.target.value)} />{errorNode}</label>;
  }

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

      {loading ? <p className={styles.empty}>Carregando modelos da campanha…</p> : null}
      {!loading && step.kind === "template" && <div className={styles.templateGrid}>
        {templates.map((item) => <button key={item.id} type="button" className={`${styles.templateChoice} ${templateId === item.id ? styles.templateSelected : ""}`} aria-pressed={templateId === item.id} disabled={busy} onClick={() => onChooseTemplate(item.id)}><span className={styles.templateMark}>✦</span><span><strong>{item.name}</strong><small>Versão {item.version} · {item.schema.fields.length} campos</small></span><span className={styles.templateArrow}>›</span></button>)}
        {templates.length === 0 && !loadError && <p className={styles.empty}>Ainda não há modelos publicados nesta campanha.</p>}
      </div>}

      {step.kind === "identity" && <div className={styles.fieldGrid}>
        <label className={`${styles.field} ${styles.wide}`} htmlFor="sheet-character-name"><span className={styles.label}>Nome do personagem<span className={styles.required}>Obrigatório</span></span><input id="sheet-character-name" maxLength={120} value={name} disabled={busy} aria-invalid={Boolean(identityFieldErrors.$name)} aria-describedby={identityFieldErrors.$name ? "sheet-character-name-error" : undefined} placeholder="Como a mesa vai chamar seu personagem?" onChange={(event) => setName(event.target.value)} />{identityFieldErrors.$name && <span className={styles.fieldError} id="sheet-character-name-error">{identityFieldErrors.$name}</span>}</label>
        {identities.map(renderField)}
      </div>}

      {step.kind === "group" && <div className={styles.fieldGrid}>{step.fields.map(renderField)}</div>}

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
        {isLast ? <button type="button" className={styles.finish} disabled={busy || !canCreate || !templateId || !name.trim()} onClick={() => void onSave()}>{busy ? "Salvando…" : "Concluir e importar para a mesa"}</button> : <button type="button" className={styles.next} disabled={busy || (step.kind === "template" && (!templateId || loading))} onClick={advance}>Continuar <span aria-hidden="true">→</span></button>}
      </footer>
      {!canCreate && isLast && <p className={styles.permissionHint}>Seu papel nesta campanha não permite criar fichas.</p>}
    </article>
    <p className={styles.visuallyHidden} role="status" aria-live="polite">{dependencyAnnouncement}</p>
    <aside className={styles.desktopPreview} aria-label="Prévia da ficha"><p className={styles.eyebrow}>PRÉVIA DA MESA</p>{previewContent}<small>Os resultados são atualizados ao preencher a ficha. Dados só são rolados na sessão.</small></aside>
    <details className={styles.mobilePreview}><summary>Ver prévia da ficha</summary>{previewContent}</details>
    {templateId && canCreate && <AiSheetRequest campaignId={campaignId} templateId={templateId} />}
  </section>;
}

function formatValue(value: FieldValue | undefined): string {
  if (value === undefined || value === "") return "Não informado";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}
