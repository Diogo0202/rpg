"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  characterNameField, creationGroups, creationStepLabel, distributionRulesFor, identityFields, isFieldActive, masterGrantedFieldIds,
  matchingDistribution, reconcileDependentValues, tallyDistribution, validateFields, type DistributionRule,
} from "../../../shared/rules/sheet-creation";
import type { FieldValue, SheetField, SheetTemplate } from "../../../shared/rules/sheet-template";
import {
  activeGrants, applyGrants, collectionPointRules, grantChoiceFieldIds, grantedItems, grantedNumbers, grantProblems, grantRules, powerRules, selectedCase,
} from "../../../shared/rules/creation-grants";
import { lockedFieldIds, priorityPatch, priorityRules, tallyPriority } from "../../../shared/rules/priority-points";
import { checkCreation, type CreationReport } from "../../lib/sheet-adjustments";
import { describeMissing, firstInvalidTarget } from "./wizard-model";

export type WizardStep = { key: string; title: string; fields: SheetField[]; kind: "template" | "identity" | "group" | "portrait" | "review" };

export type WizardInput = {
  campaignId: string;
  templateId: string;
  template: SheetTemplate;
  values: Record<string, FieldValue>;
  name: string;
  busy: boolean;
  canCreate: boolean;
  canGrantResources: boolean;
  portraitPath: string | null;
  onNameChange: (name: string) => void;
  onValueChange: (id: string, value: FieldValue | undefined) => void;
};

const CHECK_DEBOUNCE_MS = 400;

function without<T>(record: Record<string, T>, keys: string[]): Record<string, T> {
  if (!keys.some((key) => key in record)) return record;
  const next = { ...record };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * Passos, contagens e validação do assistente de criação. Os valores ficam com quem chama;
 * aqui ficam a etapa atual, os erros, os rascunhos de listas e a conferência no servidor.
 */
export function useSheetWizard(input: WizardInput) {
  const { campaignId, templateId, template, values, name, busy, canCreate, canGrantResources, portraitPath, onNameChange, onValueChange } = input;
  const masterGranted = useMemo(() => canGrantResources ? new Set<string>() : masterGrantedFieldIds(template), [canGrantResources, template]);
  const [stepIndex, setStepIndex] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [collectionDrafts, setCollectionDrafts] = useState<Record<string, string>>({});
  const [dependencyAnnouncement, setDependencyAnnouncement] = useState("");
  const [report, setReport] = useState<CreationReport | null>(null);
  const [reportError, setReportError] = useState("");
  const [chosenOptions, setChosenOptions] = useState<Record<string, number>>({});
  const [grantDialog, setGrantDialog] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const valuesKey = JSON.stringify(values);

  // A player's sheet starts with master-granted resources at zero, or the database refuses it.
  useEffect(() => {
    for (const id of masterGranted) if (typeof values[id] === "number" && values[id] !== 0) onValueChange(id, 0);
  }, [masterGranted]);

  // The backend is the source of truth for limits and creation rules; ask it as the draft changes.
  useEffect(() => {
    if (!templateId || !canCreate) { setReport(null); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      checkCreation(campaignId, templateId, values, controller.signal)
        .then((next) => { if (!controller.signal.aborted) { setReport(next); setReportError(""); } })
        .catch((problem) => { if (!controller.signal.aborted) { setReport(null); setReportError(problem instanceof Error ? problem.message : "Não foi possível conferir as regras."); } });
    }, CHECK_DEBOUNCE_MS);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [campaignId, templateId, canCreate, valuesKey]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (grantDialog && !dialog.open) dialog.showModal();
    if (!grantDialog && dialog.open) dialog.close();
  }, [grantDialog]);

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
  const pointRules = useMemo(() => new Map(collectionPointRules(template).map((rule) => [rule.collection, rule])), [template]);
  const fieldLabels = useMemo(() => new Map(template.fields.map((field) => [field.id, field.label])), [template]);

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

  function clearError(key: string) {
    setErrors((current) => without(current, [key]));
  }

  function chooseOption(rule: DistributionRule, index: number) {
    if (busy) return;
    setChosenOptions((current) => ({ ...current, [rule.id]: index }));
    clearError("$rules");
  }

  /**
   * Grava um campo e o que ele arrasta: dependentes que somem, pacotes de clã e predador,
   * e campos de prioridade que seguem a base. Uma escolha com bônus em aberto abre o diálogo.
   */
  function changeField(field: SheetField, value: FieldValue) {
    if (busy) return;
    const reconciled = reconcileDependentValues(template, { ...values, [field.id]: value });
    onValueChange(field.id, value);
    for (const id of reconciled.removedIds) onValueChange(id, undefined);
    const granted = applyGrants(template, values, reconciled.values);
    for (const [id, next] of Object.entries(granted)) onValueChange(id, next);
    const priority = priorityPatch(template, values, { ...reconciled.values, ...granted });
    for (const [id, next] of Object.entries(priority)) onValueChange(id, next);
    const opened = grantRules(template).find((rule) => rule.field === field.id && (selectedCase(rule, reconciled.values)?.choices?.length ?? 0) > 0);
    if (opened) setGrantDialog(opened.id);
    clearError(field.id);
    clearError("$rules");
    if (reconciled.removedIds.length) {
      setErrors((current) => without(current, reconciled.removedIds));
      setCollectionDrafts((current) => without(current, reconciled.removedIds));
      setDependencyAnnouncement("Os campos dependentes foram atualizados conforme a escolha controladora.");
    } else setDependencyAnnouncement("");
  }

  function stepRuleMessages(): string[] {
    const local = [
      ...pendingModeRules.map((rule) => `Escolha um modo de ${rule.label}.`),
      ...tallies.filter(({ tally }) => !tally.complete).map(({ rule, tally }) => `${rule.label}: ${describeMissing(tally)}`),
      ...grantProblems(template, values, stepFieldIds, fieldLabels),
      ...stepPools.flatMap(({ tally, pool }) => [
        ...pool.problems,
        ...(pool.shortfall ? [`${pool.pool.label}: faltam ${pool.shortfall} ${pool.shortfall === 1 ? "ponto" : "pontos"} da distribuição inicial.`] : []),
        ...(tally.remaining < 0 ? [`Bônus: ${-tally.remaining} a mais que os ${tally.remaining + tally.bonus} disponíveis.`] : []),
      ]),
    ];
    return local.length ? local : stepViolations.map((violation) => violation.message);
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
      const messages = stepRuleMessages();
      if (messages.length) nextErrors.$rules = messages.join(" ");
    }
    setErrors(nextErrors);
    if (step.kind === "group" && pendingModeRules.length) { document.getElementById(`sheet-mode-${pendingModeRules[0].id}`)?.focus(); return; }
    const target = firstInvalidTarget(nextErrors, step.kind === "identity");
    if (target) { document.getElementById(target)?.focus(); return; }
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

  const dialogRule = grantRules(template).find((rule) => rule.id === grantDialog);

  return {
    steps, step, stepIndex, isLast, errors, clearError, dependencyAnnouncement, report, reportError, stepViolations, rulesBlockFinish,
    nameField, identities, grants, priorityTallies, priorityOpen, stepPools, stepRules, tallies, hiddenFieldIds, chosenOption, chooseOption,
    changeField, advance, back, setName,
    fieldContext: {
      template, values, busy, errors, enforcedNumbers, lockedItems, pickRules, pointRules, fieldLabels, masterGranted, collectionDrafts,
      setCollectionDraft: (fieldId: string, text: string) => setCollectionDrafts((current) => ({ ...current, [fieldId]: text })),
      changeField,
    },
    dialog: {
      ref: dialogRef,
      rule: dialogRule,
      selectedCase: dialogRule ? selectedCase(dialogRule, values) : undefined,
      missing: dialogRule ? grants.find((item) => item.rule.id === dialogRule.id)?.missing.length ?? 0 : 0,
      open: setGrantDialog,
      close: () => setGrantDialog(null),
    },
  };
}

export type SheetWizardState = ReturnType<typeof useSheetWizard>;
export type FieldContext = SheetWizardState["fieldContext"] & { calculated: Record<string, unknown> };
