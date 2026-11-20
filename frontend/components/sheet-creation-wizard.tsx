"use client";

import type { FieldValue, SheetTemplate, StoredTemplate } from "../../shared/rules/sheet-template";
import { stepHelp } from "../../shared/rules/step-help";
import { AiSheetRequest } from "./ai-assistance-panel";
import { PortraitPicker } from "./portrait-picker";
import { useSheetWizard, type SheetWizardState } from "./sheet-wizard/use-sheet-wizard";
import { WizardField } from "./sheet-wizard/wizard-field";
import { DistributionRules, GrantDialog, GrantSummaries, PriorityBoard, ReviewStep, WizardPreview } from "./sheet-wizard/wizard-parts";
import styles from "./sheet-creation-wizard.module.css";

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

function RulesBox({ wizard }: { wizard: SheetWizardState }) {
  const { step, isLast, errors, stepViolations, report, reportError } = wizard;
  const relevant = step.kind === "group" || step.kind === "identity" || isLast;
  const hasContent = stepViolations.length > 0 || (step.kind !== "review" && errors.$rules) || (isLast && (report?.field_errors.length ?? 0) > 0) || reportError;
  if (!relevant || !hasContent) return null;
  return <div id="sheet-rules" tabIndex={-1} className={styles.rules} role="status" aria-live="polite">
    <strong>{reportError ? "Regras não conferidas" : "Regras de criação"}</strong>
    {reportError ? <p>{reportError} O servidor confere de novo ao salvar.</p> : <ul>
      {stepViolations.length === 0 && errors.$rules && <li>{errors.$rules}</li>}
      {stepViolations.map((violation) => <li key={violation.rule_id}>{violation.message}</li>)}
      {isLast && report?.field_errors.map((error) => <li key={error}>{error}</li>)}
    </ul>}
  </div>;
}

export function SheetCreationWizard(props: Props) {
  const {
    campaignId, templates, templateId, template, values, name, calculated, busy, canCreate, loading,
    loadError, feedback, calculationError, onChooseTemplate, onSave, onOpenEditor, viewerId, portraitPath, onPortraitChange,
  } = props;
  const wizard = useSheetWizard(props);
  const { steps, step, stepIndex, isLast, errors } = wizard;
  const ctx = { ...wizard.fieldContext, calculated };
  const help = stepHelp(template.system_key, step.key);
  const canFinish = canCreate && Boolean(templateId) && Boolean(name.trim()) && Boolean(portraitPath) && !wizard.rulesBlockFinish && wizard.priorityOpen.length === 0;
  const previewProps = { wizard, template, values, name, calculated };

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
      {help && <p className={styles.intro}>{help}</p>}

      {loading ? <p className={styles.empty}>Carregando modelos da campanha…</p> : null}
      {!loading && step.kind === "template" && <div className={styles.templateGrid}>
        {templates.map((item) => <button key={item.id} type="button" className={`${styles.templateChoice} ${templateId === item.id ? styles.templateSelected : ""}`} aria-pressed={templateId === item.id} disabled={busy} onClick={() => onChooseTemplate(item.id)}><span className={styles.templateMark}>✦</span><span><strong>{item.name}</strong><small>Versão {item.version} · {item.schema.fields.length} campos</small></span><span className={styles.templateArrow}>›</span></button>)}
        {templates.length === 0 && !loadError && <p className={styles.empty}>Ainda não há modelos publicados nesta campanha.</p>}
      </div>}

      {step.kind === "identity" && <div className={styles.fieldGrid}>
        <label className={`${styles.field} ${styles.wide}`} htmlFor="sheet-character-name"><span className={styles.label}>Nome do personagem<span className={styles.required}>Obrigatório</span></span><input id="sheet-character-name" maxLength={120} value={name} disabled={busy} aria-invalid={Boolean(errors.$name)} aria-describedby={errors.$name ? "sheet-character-name-error" : undefined} placeholder="Como a mesa vai chamar seu personagem?" onChange={(event) => wizard.setName(event.target.value)} />{errors.$name && <span className={styles.fieldError} id="sheet-character-name-error">{errors.$name}</span>}</label>
        {wizard.identities.map((field) => <WizardField key={field.id} ctx={ctx} field={field} />)}
        <GrantSummaries wizard={wizard} template={template} busy={busy} />
      </div>}

      {step.kind === "group" && <DistributionRules wizard={wizard} busy={busy} />}

      {step.kind === "group" && wizard.priorityTallies.map((tally) => {
        const pools = wizard.stepPools.filter((item) => item.tally === tally).map((item) => item.pool);
        return pools.length ? <PriorityBoard key={tally.rule.id} tally={tally} pools={pools} /> : null;
      })}

      {step.kind === "group" && <div className={styles.fieldGrid}>{step.fields.filter((field) => !wizard.hiddenFieldIds.has(field.id)).map((field) => <WizardField key={field.id} ctx={ctx} field={field} />)}</div>}

      {isLast && wizard.priorityOpen.length > 0 && <div className={styles.rules} role="status" aria-live="polite">
        <strong>Falta distribuir pontos</strong>
        <ul>{wizard.priorityOpen.flatMap((tally) => tally.problems.map((problem) => <li key={`${tally.rule.id}-${problem}`}>{problem}</li>))}</ul>
      </div>}

      <RulesBox wizard={wizard} />

      {step.kind === "portrait" && <PortraitPicker campaignId={campaignId} uploaderId={viewerId} value={portraitPath} name={name}
        disabled={busy} error={errors.$portrait} onChange={(path) => { onPortraitChange(path); wizard.clearError("$portrait"); }} />}

      {step.kind === "review" && <ReviewStep {...previewProps} />}

      <footer className={styles.actions}>
        <button type="button" className={styles.back} disabled={busy || stepIndex === 0} onClick={wizard.back}>Voltar</button>
        {isLast ? <button type="button" className={styles.finish} disabled={busy || !canFinish} onClick={() => void onSave()}>{busy ? "Salvando…" : "Concluir e importar para a mesa"}</button> : <button type="button" className={styles.next} disabled={busy || (step.kind === "template" && (!templateId || loading))} onClick={wizard.advance}>Continuar <span aria-hidden="true">→</span></button>}
      </footer>
      {!canCreate && isLast && <p className={styles.permissionHint}>Seu papel nesta campanha não permite criar fichas.</p>}
    </article>
    <GrantDialog wizard={wizard} template={template} values={values} busy={busy} />
    <p className={styles.visuallyHidden} role="status" aria-live="polite">{wizard.dependencyAnnouncement}</p>
    <aside className={styles.desktopPreview} aria-label="Prévia da ficha"><p className={styles.eyebrow}>PRÉVIA DA MESA</p><WizardPreview {...previewProps} /><small>Os resultados são atualizados ao preencher a ficha. Dados só são rolados na sessão.</small></aside>
    <details className={styles.mobilePreview}><summary>Ver prévia da ficha</summary><WizardPreview {...previewProps} /></details>
    {templateId && canCreate && <AiSheetRequest campaignId={campaignId} templateId={templateId} />}
  </section>;
}
