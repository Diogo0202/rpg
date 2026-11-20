"use client";

import { useEffect, useRef, useState } from "react";

import { browserDb } from "../../lib/data/browser";
import * as sheetRepo from "../../lib/data/sheets";
import { apiBase, sessionToken } from "../../lib/api/session";
import { useCharacterSession, type CharacterEffect } from "../../lib/character-session";
import { findCompendiumEntry } from "../../lib/compendium";
import { buildChronicleContext, newRollKey, withChronicle, type ChronicleActivityStatus } from "../../lib/chronicle-context";
import { createCampaignSheet } from "../../lib/sheet-api";
import { deleteCampaignSheet } from "../../lib/sheet-history";
import { SYSTEM_STARTERS } from "../../../shared/rules/system-starters";
import { characterNameField, type FieldKind, type FieldValue, type SelectDependency, type SheetField, type SheetTemplate, type StoredTemplate } from "../../../shared/rules/sheet-template";
import { reconcileDependentValues } from "../../../shared/rules/sheet-creation";
import { authenticatedPost, authenticatedPostWithChronicle, type ModifierPreview } from "../character-effects-panel";
import {
  collectSheetValues, dependencyCases, INITIAL_TEMPLATE, kindChange, nextFieldId, orphanedDependencyCase, releaseDependents,
  renameFieldInTemplate, stringItems, valuesWithName,
} from "./template-model";

export type RollResult = { rolls: number[]; modifier: number; total: number; preview?: ModifierPreview; chronicle?: ChronicleActivityStatus | null };
export type StoredSheet = { id: string; name: string; template_id: string; owner_id: string; values: Record<string, FieldValue>; version: number; effects: CharacterEffect[]; portrait_path: string | null };

const FORMULA_DEBOUNCE_MS = 400;

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Estado da oficina de fichas: modelo em edição, ficha escolhida, prévia calculada e gravações.
 * `editorRevision` muda a cada edição; uma resposta da API que chega depois de outra edição é descartada.
 */
export function useSheetBuilder({ campaignId, viewerId, canManageTemplates, canEditSheets }: {
  campaignId: string; viewerId: string; canManageTemplates: boolean; canEditSheets: boolean;
}) {
  const { character, selectCharacter, contextTags } = useCharacterSession();
  const editorRevision = useRef(0);
  const selectedCharacterId = useRef(character?.id);
  selectedCharacterId.current = character?.id;
  const rollRules = useRef("");
  rollRules.current = JSON.stringify({ effects: character?.effects, contextTags });
  const [template, setTemplate] = useState<SheetTemplate>(INITIAL_TEMPLATE);
  const [values, setValues] = useState<Record<string, FieldValue>>({});
  const [templates, setTemplates] = useState<StoredTemplate[]>([]);
  const [sheets, setSheets] = useState<StoredSheet[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [sheetName, setSheetName] = useState("");
  const [sheetVersion, setSheetVersion] = useState(0);
  const [calculated, setCalculated] = useState<Record<string, unknown>>({});
  const [rollResults, setRollResults] = useState<Record<string, RollResult>>({});
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"guided" | "editor">("guided");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [calculationError, setCalculationError] = useState("");
  const [portraitPath, setPortraitPath] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let active = true;
    const db = browserDb();
    async function load() {
      setLoading(true);
      setLoadError("");
      const [templateResult, sheetResult] = await Promise.all([
        sheetRepo.listApprovedTemplates(db, campaignId),
        sheetRepo.listCampaignSheets(db, campaignId),
      ]);
      if (!active) return;
      if (templateResult.error || sheetResult.error) {
        setLoadError("Não foi possível carregar os modelos e fichas. Confira a conexão e reabra esta campanha.");
        setLoading(false);
        return;
      }
      setTemplates((templateResult.data ?? []) as StoredTemplate[]);
      setSheets((sheetResult.data ?? []) as StoredSheet[]);
      setLoading(false);
    }
    void load().catch(() => {
      if (active) {
        setLoadError("Não foi possível carregar as fichas. Reabra esta campanha para tentar novamente.");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [campaignId]);

  useEffect(() => {
    if (character && character.id !== sheetId && sheets.some((sheet) => sheet.id === character.id)) chooseSheet(character.id);
    else if (!character && sheetId) { setSheetId(""); setSheetName(""); setSheetVersion(0); setValues({}); setCalculated({}); }
    // chooseSheet reads the latest sheets/templates; the selection is what drives this effect.
  }, [character?.id, sheets, templates]);

  /** Fotografia da edição atual; `isCurrent()` diz se nada mudou desde então. */
  function snapshot(withRollRules = false) {
    const revision = editorRevision.current;
    const selection = selectedCharacterId.current;
    const rules = rollRules.current;
    return () => editorRevision.current === revision && selectedCharacterId.current === selection && (!withRollRules || rules === rollRules.current);
  }

  function clearResults() {
    setCalculated({});
    setRollResults({});
  }

  function clearSheet() {
    setSheetId(""); setSheetName(""); setSheetVersion(0);
  }

  /** Qualquer mudança no modelo o tira do estado "salvo" e invalida a prévia. */
  function editTemplate(update: (current: SheetTemplate) => SheetTemplate) {
    editorRevision.current += 1;
    setTemplateId("");
    setTemplate(update);
  }

  function chooseTemplate(id: string) {
    if (busy) return;
    editorRevision.current += 1;
    selectCharacter(null);
    const stored = templates.find((item) => item.id === id);
    setTemplateId(id);
    setTemplate(stored?.schema ?? INITIAL_TEMPLATE);
    clearSheet();
    setPortraitPath(null);
    setValues({});
    clearResults();
    setFeedback("");
  }

  function chooseSheet(id: string) {
    if (busy) return;
    editorRevision.current += 1;
    const stored = sheets.find((item) => item.id === id);
    if (!stored) { selectCharacter(null); clearSheet(); setValues({}); return; }
    const source = templates.find((item) => item.id === stored.template_id);
    if (!source) { setFeedback("O modelo desta ficha não está disponível."); return; }
    setTemplate(source.schema);
    setTemplateId(source.id);
    setSheetId(stored.id);
    setSheetName(stored.name);
    setSheetVersion(stored.version);
    setPortraitPath(stored.portrait_path ?? null);
    setValues(valuesWithName(source.schema, stored.values, stored.name));
    clearResults();
    setFeedback("");
    setConfirmDelete(false);
    selectCharacter(stored);
    setMode("editor");
  }

  function loadStarter(id: string) {
    if (busy) return;
    const starter = SYSTEM_STARTERS.find((item) => item.id === id);
    if (!starter) return;
    editorRevision.current += 1;
    selectCharacter(null);
    setTemplate(starter.template);
    setTemplateId("");
    clearSheet();
    setValues({ ...starter.values });
    clearResults();
    setFeedback(`Base de ${starter.label} carregada. Revise os campos e salve o modelo na campanha.`);
  }

  async function saveTemplate() {
    if (!canManageTemplates) return;
    const orphan = orphanedDependencyCase(template);
    if (orphan) {
      setFeedback(`O caso “${orphan.equals || "sem valor"}” de ${orphan.field.label} não corresponde às opções válidas do campo controlador.`);
      return;
    }
    if (!apiBase()) { setFeedback("Configure NEXT_PUBLIC_API_URL para validar o modelo."); return; }
    setBusy(true);
    const isCurrent = snapshot();
    try {
      await authenticatedPost("/api/v1/templates/validate", template);
      if (!isCurrent()) return;
      const { data, error } = await sheetRepo.insertApprovedTemplate(browserDb(), {
        campaignId, ownerId: viewerId, name: template.name, version: template.version, schema: template,
      });
      if (error || !data) throw new Error(error?.message ?? "Não foi possível salvar o modelo.");
      setTemplates((current) => [...current, data as StoredTemplate]);
      if (!isCurrent()) return;
      setTemplateId(data.id);
      setFeedback("Modelo salvo na campanha. Agora crie uma ficha.");
    } catch (error) {
      if (isCurrent()) setFeedback(errorText(error, "Não foi possível salvar o modelo."));
    } finally { setBusy(false); }
  }

  /** Ficha nova vai pela API (que confere o modelo); ficha existente grava com trava de versão. */
  async function saveSheet(submittedValues?: Record<string, FieldValue>) {
    if (busy) return;
    if (!canEditSheets) { setFeedback("Seu papel nesta campanha permite apenas leitura das fichas."); return; }
    if (!templateId) { setFeedback("Selecione um modelo salvo antes de gravar a ficha."); return; }
    const name = (typeof submittedValues?.nome === "string" ? submittedValues.nome : sheetName).trim();
    if (!name || name.length > 120) { setFeedback("Informe um nome de ficha com até 120 caracteres."); return; }
    const portraitOptional = template.system_key === "one-ring" && template.rules_profile_version === 3;
    if (!sheetId && !portraitPath && !portraitOptional) { setFeedback("Envie o retrato do personagem antes de criar a ficha."); return; }
    setBusy(true);
    const isCurrent = snapshot();
    try {
      const payloadValues = submittedValues ?? collectSheetValues(template, values, sheetName) as Record<string, FieldValue>;
      if (sheetId) {
        const { data, error } = await sheetRepo.updateSheetValues(browserDb(), { id: sheetId, campaignId, version: sheetVersion },
          { name, values: payloadValues, portrait_path: portraitPath });
        if (error || !data) throw new Error(error?.message ?? "A ficha mudou em outra sessão. Reabra antes de salvar.");
        setSheets((current) => current.map((item) => item.id === data.id ? data as StoredSheet : item));
        if (!isCurrent()) return;
        setSheetVersion(data.version);
        selectCharacter(data as StoredSheet);
      } else {
        const api = apiBase();
        if (!api) throw new Error("A API de fichas não está configurada. O preenchimento continua nesta tela.");
        const token = await sessionToken("Entre na campanha para salvar esta ficha.");
        const data = await createCampaignSheet(api, token, campaignId, {
          template_id: templateId, name, values: payloadValues, ...(portraitPath ? { portrait_path: portraitPath } : {}),
        }) as StoredSheet;
        data.effects ??= [];
        setSheets((current) => [...current, data]);
        if (!isCurrent()) return;
        setSheetId(data.id);
        setSheetVersion(data.version);
        selectCharacter(data);
        setMode("editor");
        setValues(payloadValues); setSheetName(name);
      }
      setFeedback("Ficha salva e selecionada para a sessão.");
    } catch (error) {
      if (isCurrent()) setFeedback(errorText(error, "Não foi possível salvar a ficha."));
      if (submittedValues) throw error;
    } finally { setBusy(false); }
  }

  // FIC-11: only campaign managers may delete (RLS); the API checks the version.
  async function deleteSheet() {
    if (busy || !sheetId || !canManageTemplates) return;
    const api = apiBase();
    if (!api) { setFeedback("A API de fichas não está configurada."); return; }
    setBusy(true);
    const removedId = sheetId;
    const removedName = sheetName;
    try {
      const token = await sessionToken("Entre na campanha para excluir a ficha.");
      await deleteCampaignSheet(api, token, removedId, sheetVersion);
      editorRevision.current += 1;
      setSheets((current) => current.filter((item) => item.id !== removedId));
      selectCharacter(null);
      clearSheet(); setPortraitPath(null);
      setValues({}); clearResults();
      setFeedback(`Ficha ${removedName || "selecionada"} excluída.`);
    } catch (error) {
      setFeedback(errorText(error, "Não foi possível excluir a ficha."));
    } finally {
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  function applyRestoredSheet(restored: Record<string, unknown>) {
    const stored = { effects: [], ...restored } as unknown as StoredSheet;
    setSheets((current) => current.map((item) => item.id === stored.id ? { ...item, ...stored } : item));
    if (stored.id !== sheetId) return;
    editorRevision.current += 1;
    setSheetVersion(stored.version);
    setSheetName(stored.name);
    setValues(valuesWithName(template, stored.values, stored.name));
    clearResults();
    selectCharacter(stored);
    setFeedback(`Ficha restaurada. Versão atual: ${stored.version}.`);
  }

  function updateField(fieldId: string, update: Partial<SheetField>) {
    editTemplate((current) => ({ ...current, fields: current.fields.map((field) => field.id === fieldId ? { ...field, ...update } : field) }));
    clearResults();
    setFeedback("");
  }

  function renameField(fieldId: string, nextId: string) {
    editorRevision.current += 1;
    if (!nextId) { setFeedback("O ID precisa começar com uma letra minúscula."); return; }
    if (nextId !== fieldId && template.fields.some((field) => field.id === nextId)) { setFeedback("Este ID já está em uso por outro campo."); return; }
    editTemplate((current) => renameFieldInTemplate(current, fieldId, nextId));
    clearResults();
    setFeedback("");
    setValues((current) => {
      const next = { ...current };
      const previousValue = next[fieldId];
      delete next[fieldId];
      if (previousValue !== undefined) next[nextId] = previousValue;
      return next;
    });
  }

  function changeKind(field: SheetField, kind: FieldKind) {
    updateField(field.id, kindChange(field, kind));
    if (kind !== "select") setTemplate((current) => ({ ...current, fields: releaseDependents(current.fields, field.id) }));
  }

  function addField() {
    const id = nextFieldId(template);
    editTemplate((current) => ({ ...current, fields: [...current.fields, { id, label: "Novo campo", kind: "text", required: false, options: [], expression: null }] }));
    setValues((current) => ({ ...current, [id]: "" }));
    setFeedback("");
  }

  function removeField(fieldId: string) {
    editTemplate((current) => ({ ...current, fields: releaseDependents(current.fields.filter((field) => field.id !== fieldId), fieldId) }));
    setValues((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    clearResults();
  }

  function markCharacterNameField(fieldId: string, checked: boolean) {
    editTemplate((current) => ({ ...current, fields: current.fields.map((item) => ({ ...item, character_name: item.id === fieldId ? checked : false })) }));
  }

  function setValue(fieldId: string, value: FieldValue | undefined) {
    if (busy) return;
    editorRevision.current += 1;
    setValues((current) => {
      const next = { ...current };
      if (value === undefined) delete next[fieldId];
      else next[fieldId] = value;
      return reconcileDependentValues(template, next).values;
    });
    if (characterNameField(template)?.id === fieldId && typeof value === "string") setSheetName(value);
    clearResults();
    setFeedback("");
  }

  function configureDependency(fieldId: string, parentId: string) {
    const field = template.fields.find((item) => item.id === fieldId);
    const parent = template.fields.find((item) => item.id === parentId && item.kind === "select");
    if (!field) return;
    if (!parent) {
      const restoredOptions = field.depends_on?.cases.flatMap((item) => item.options) ?? field.options;
      updateField(fieldId, { depends_on: undefined, options: [...new Set(restoredOptions)] });
      return;
    }
    updateField(fieldId, { options: [], depends_on: { field_id: parent.id, cases: dependencyCases(field, parent) } });
  }

  function editDependencyCases(fieldId: string, update: (cases: SelectDependency["cases"]) => SelectDependency["cases"]) {
    const field = template.fields.find((item) => item.id === fieldId);
    if (!field?.depends_on) return;
    updateField(fieldId, { depends_on: { ...field.depends_on, cases: update(field.depends_on.cases) } });
  }

  const dependency = {
    configure: configureDependency,
    updateCase: (fieldId: string, index: number, update: Partial<SelectDependency["cases"][number]>) =>
      editDependencyCases(fieldId, (cases) => cases.map((item, caseIndex) => caseIndex === index ? { ...item, ...update } : item)),
    addCase: (fieldId: string) => editDependencyCases(fieldId, (cases) => [...cases, { equals: "", options: [] }]),
    removeCase: (fieldId: string, index: number) => editDependencyCases(fieldId, (cases) => cases.filter((_, caseIndex) => caseIndex !== index)),
  };

  function changeCharacterName(name: string) {
    if (busy) return;
    editorRevision.current += 1;
    setSheetName(name);
    const field = characterNameField(template);
    if (field) setValues((current) => ({ ...current, [field.id]: name }));
    setFeedback("");
  }

  function startCreation() {
    if (sheetId) chooseTemplate(templateId);
    setMode("guided");
  }

  function addFromCompendium(name: string) {
    const entry = findCompendiumEntry(name);
    const fieldId = entry?.type === "discipline" ? "disciplinas" : "vantagens";
    if (!template.fields.some((field) => field.id === fieldId && field.kind === "collection")) { setFeedback("O modelo não possui a coleção correspondente ao verbete."); return; }
    setValue(fieldId, [...new Set([...stringItems(values[fieldId]), name])]);
  }

  // Prévia: sem fórmulas, os próprios valores; com fórmulas, a API calcula depois de uma pausa na digitação.
  useEffect(() => {
    const hasFormula = template.fields.some((field) => field.kind === "formula");
    if (!apiBase()) {
      setCalculationError(hasFormula ? "A API de cálculos não está configurada." : "");
      return;
    }
    let payloadValues: Record<string, unknown>;
    try {
      payloadValues = collectSheetValues(template, values, sheetName, true);
    } catch {
      setCalculated({});
      return;
    }
    if (!hasFormula) {
      setCalculated(payloadValues);
      setCalculationError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await authenticatedPost("/api/v1/sheets/calculate", { template, values: payloadValues }, controller.signal) as { values: Record<string, unknown> };
        if (!controller.signal.aborted) {
          setCalculated(result.values);
          setCalculationError("");
        }
      } catch {
        if (!controller.signal.aborted) {
          setCalculated({});
          setCalculationError("A prévia ainda não pôde ser calculada. Confira os campos numéricos e a conexão.");
        }
      }
    }, FORMULA_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [template, values, sheetName]);

  async function rollFields(isCurrent: () => boolean): Promise<Record<string, RollResult> | null> {
    const nextRolls: Record<string, RollResult> = {};
    for (const field of template.fields.filter((item) => item.kind === "roll")) {
      if (!isCurrent()) return null;
      const chronicle = buildChronicleContext({ sheetId: sheetId || null, campaignId, rollKey: newRollKey(`field:${field.id}`), rollFieldId: field.id });
      const { data, chronicle: activity } = await authenticatedPostWithChronicle("/api/v1/dice/roll", withChronicle({
        expression: field.expression, context_tags: contextTags,
        effects: character?.id === sheetId ? character.effects : [],
      }, chronicle));
      const result = data as { rolls: number[]; modifier: number; total: number; modifier_preview?: ModifierPreview };
      if (!isCurrent()) return null;
      nextRolls[field.id] = { ...result, preview: result.modifier_preview, chronicle: activity };
    }
    return nextRolls;
  }

  async function validateAndCalculate() {
    if (!apiBase()) {
      setFeedback("Configure NEXT_PUBLIC_API_URL para validar e calcular esta ficha.");
      return;
    }
    setBusy(true);
    const isCurrent = snapshot(true);
    setFeedback("");
    try {
      const payloadValues = collectSheetValues(template, values, sheetName);
      await authenticatedPost("/api/v1/templates/validate", template);
      if (!isCurrent()) return;
      const calculation = await authenticatedPost("/api/v1/sheets/calculate", { template, values: payloadValues }) as { values: Record<string, unknown> };
      if (!isCurrent()) return;
      setCalculated(calculation.values);
      const nextRolls = await rollFields(isCurrent);
      if (!nextRolls) return;
      setRollResults(nextRolls);
      setFeedback("Template validado. Prévia atualizada.");
    } catch (error) {
      if (isCurrent()) {
        clearResults();
        setFeedback(errorText(error, "Não foi possível validar esta ficha."));
      }
    } finally {
      setBusy(false);
    }
  }

  return {
    template, values, templates, sheets, templateId, sheetId, sheetName, sheetVersion, calculated, rollResults, feedback, setFeedback,
    busy, mode, setMode, loading, loadError, calculationError, portraitPath, setPortraitPath, confirmDelete, setConfirmDelete,
    chooseTemplate, chooseSheet, loadStarter, startCreation, changeCharacterName, setValue, addFromCompendium,
    saveTemplate, saveSheet, deleteSheet, applyRestoredSheet, validateAndCalculate,
    fields: {
      editTemplate, updateField, renameField, changeKind, addField, removeField, markCharacterNameField, dependency,
    },
  };
}

export type SheetBuilderState = ReturnType<typeof useSheetBuilder>;
