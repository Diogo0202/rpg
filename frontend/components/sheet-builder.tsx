"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "../lib/supabase/client";
import { useCharacterSession, type CharacterEffect } from "../lib/character-session";
import { CompendiumPanel, CompendiumReference } from "./compendium-panel";
import { findCompendiumEntry } from "../lib/compendium";
import { authenticatedPost, type ModifierPreview } from "./character-effects-panel";
import { SYSTEM_STARTERS } from "../lib/system-starters";
import { characterNameField, fieldKinds, creationSteps, identityKinds, type FieldKind, type SheetField, type SheetTemplate, type FieldValue, type StoredTemplate } from "../lib/sheet-template";
import { createCampaignSheet } from "../lib/sheet-api";
import { SheetCreationWizard } from "./sheet-creation-wizard";
type RollResult = { rolls: number[]; modifier: number; total: number; preview?: ModifierPreview };
type StoredSheet = { id: string; name: string; template_id: string; values: Record<string, FieldValue>; version: number; effects: CharacterEffect[] };
const stepLabels = { identity: "Identidade", attributes: "Atributos", skills: "Habilidades", traits: "Poderes e vantagens", resources: "Recursos", story: "História", other: "Outros" };
const identityLabels = { race: "Raça", subrace: "Sub-raça", clan: "Clã", predator: "Predador", creed: "Credo", lineage: "Linhagem", origin: "Origem", archetype: "Arquétipo" };

const initialTemplate: SheetTemplate = {
  name: "Investigador do Outro Lado",
  version: 1,
  fields: [
    { id: "nome", label: "Nome", kind: "text", required: true, options: [], expression: null },
    { id: "vigor", label: "Vigor", kind: "number", required: true, options: [], expression: null },
    { id: "astucia", label: "Astúcia", kind: "number", required: true, options: [], expression: null },
    { id: "perfil", label: "Área de atuação", kind: "select", required: false, options: ["Investigação", "Medicina", "Ocultismo"], expression: null },
    { id: "ferimentos", label: "Ferimentos", kind: "number", required: false, options: [], expression: null },
    { id: "contatos", label: "Contatos", kind: "collection", required: false, options: [], expression: null },
    { id: "protegido", label: "Tem proteção", kind: "checkbox", required: false, options: [], expression: null },
    { id: "parada", label: "Parada de investigação", kind: "formula", required: false, options: [], expression: "vigor + astucia" },
    { id: "teste", label: "Teste de risco", kind: "roll", required: false, options: [], expression: "2d6+3" },
  ],
};


export function SheetBuilder({ campaignId, viewerId, canManageTemplates, canEditSheets }: { campaignId: string; viewerId: string; canManageTemplates: boolean; canEditSheets: boolean }) {
  const { character, selectCharacter, contextTags } = useCharacterSession();
  const editorRevision = useRef(0);
  const selectedCharacterId = useRef(character?.id);
  selectedCharacterId.current = character?.id;
  const rollRules = useRef("");
  rollRules.current = JSON.stringify({ effects: character?.effects, contextTags });
  const [template, setTemplate] = useState<SheetTemplate>(initialTemplate);
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

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    async function load() {
      setLoading(true);
      setLoadError("");
      const [templateResult, sheetResult] = await Promise.all([
        supabase.from("system_templates").select("id, name, version, schema").eq("campaign_id", campaignId).eq("status", "approved").order("name"),
        supabase.from("character_sheets").select("id, name, template_id, values, version, effects").eq("campaign_id", campaignId).order("name"),
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
  }, [character?.id, sheets, templates]);

  function chooseTemplate(id: string) {
    if (busy) return;
    editorRevision.current += 1;
    selectCharacter(null);
    const stored = templates.find((item) => item.id === id);
    setTemplateId(id);
    setTemplate(stored?.schema ?? initialTemplate);
    setSheetId("");
    setSheetName("");
    setSheetVersion(0);
    setValues({});
    setCalculated({});
    setRollResults({});
    setFeedback("");
  }

  function chooseSheet(id: string) {
    if (busy) return;
    editorRevision.current += 1;
    const stored = sheets.find((item) => item.id === id);
    if (!stored) { selectCharacter(null); setSheetId(""); setSheetName(""); setSheetVersion(0); setValues({}); return; }
    const source = templates.find((item) => item.id === stored.template_id);
    if (!source) { setFeedback("O modelo desta ficha não está disponível."); return; }
    setTemplate(source.schema);
    setTemplateId(source.id);
    setSheetId(stored.id);
    setSheetName(stored.name);
    setSheetVersion(stored.version);
    const nameField = characterNameField(source.schema);
    setValues(nameField ? { ...stored.values, [nameField.id]: stored.name } : stored.values);
    setCalculated({});
    setRollResults({});
    setFeedback("");
    selectCharacter(stored);
    setMode("editor");
  }

  function loadStarter(id:string) {
    if (busy) return;
    const starter=SYSTEM_STARTERS.find(item=>item.id===id);
    if(!starter)return;
    editorRevision.current += 1;
    selectCharacter(null);
    setTemplate(starter.template);
    setTemplateId("");
    setSheetId("");
    setSheetName("");
    setSheetVersion(0);
    setValues({...starter.values});
    setCalculated({});
    setRollResults({});
    setFeedback(`Base de ${starter.label} carregada. Revise os campos e salve o modelo na campanha.`);
  }

  async function saveTemplate() {
    if (!canManageTemplates) return;
    const api = process.env.NEXT_PUBLIC_API_URL;
    if (!api) { setFeedback("Configure NEXT_PUBLIC_API_URL para validar o modelo."); return; }
    setBusy(true);
    const revision = editorRevision.current;
    const selection = selectedCharacterId.current;
    const isCurrent = () => editorRevision.current === revision && selectedCharacterId.current === selection;
    try {
      await authenticatedPost("/api/v1/templates/validate", template);
      if (!isCurrent()) return;
      const supabase = createClient();
      const { data, error } = await supabase.from("system_templates").insert({
        campaign_id: campaignId,
        owner_id: viewerId,
        name: template.name,
        version: template.version,
        schema: template,
        status: "approved",
        approved_at: new Date().toISOString(),
      }).select("id, name, version, schema").single();
      if (error || !data) throw new Error(error?.message ?? "Não foi possível salvar o modelo.");
      setTemplates((current) => [...current, data as StoredTemplate]);
      if (!isCurrent()) return;
      setTemplateId(data.id);
      setFeedback("Modelo salvo na campanha. Agora crie uma ficha.");
    } catch (error) {
      if (isCurrent()) setFeedback(error instanceof Error ? error.message : "Não foi possível salvar o modelo.");
    } finally { setBusy(false); }
  }

  async function saveSheet() {
    if (busy) return;
    if (!canEditSheets) { setFeedback("Seu papel nesta campanha permite apenas leitura das fichas."); return; }
    if (!templateId) { setFeedback("Selecione um modelo salvo antes de gravar a ficha."); return; }
    const name = sheetName.trim();
    if (!name || name.length > 120) { setFeedback("Informe um nome de ficha com até 120 caracteres."); return; }
    setBusy(true);
    const revision = editorRevision.current;
    const selection = selectedCharacterId.current;
    const isCurrent = () => editorRevision.current === revision && selectedCharacterId.current === selection;
    try {
      const payloadValues = collectValues() as Record<string, FieldValue>;
      const supabase = createClient();
      if (sheetId) {
        const { data, error } = await supabase.from("character_sheets")
          .update({ name, values: payloadValues, version: sheetVersion + 1, updated_at: new Date().toISOString() })
          .eq("id", sheetId).eq("campaign_id", campaignId).eq("version", sheetVersion)
          .select("id, name, template_id, values, version, effects").maybeSingle();
        if (error || !data) throw new Error(error?.message ?? "A ficha mudou em outra sessão. Reabra antes de salvar.");
        setSheets((current) => current.map((item) => item.id === data.id ? data as StoredSheet : item));
        if (!isCurrent()) return;
        setSheetVersion(data.version);
        selectCharacter(data as StoredSheet);
      } else {
        const api = process.env.NEXT_PUBLIC_API_URL;
        if (!api) throw new Error("A API de fichas não está configurada. O preenchimento continua nesta tela.");
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !sessionData.session) throw new Error("Entre na campanha para salvar esta ficha.");
        const data = await createCampaignSheet(api, sessionData.session.access_token, campaignId, {
          template_id: templateId, name, values: payloadValues,
        }) as StoredSheet;
        data.effects ??= [];
        setSheets((current) => [...current, data]);
        if (!isCurrent()) return;
        setSheetId(data.id);
        setSheetVersion(data.version);
        selectCharacter(data);
        setMode("editor");
      }
      setFeedback("Ficha salva e selecionada para a sessão.");
    } catch (error) {
      if (isCurrent()) setFeedback(error instanceof Error ? error.message : "Não foi possível salvar a ficha.");
    } finally { setBusy(false); }
  }

  function updateField(fieldId: string, update: Partial<SheetField>) {
    editorRevision.current += 1;
    setTemplateId("");
    setTemplate((current) => ({
      ...current,
      fields: current.fields.map((field) => field.id === fieldId ? { ...field, ...update } : field),
    }));
    setCalculated({});
    setRollResults({});
    setFeedback("");
  }

  function renameField(fieldId: string, nextId: string) {
    editorRevision.current += 1;
    if (!nextId) {
      setFeedback("O ID precisa começar com uma letra minúscula.");
      return;
    }
    if (nextId !== fieldId && template.fields.some((field) => field.id === nextId)) {
      setFeedback("Este ID já está em uso por outro campo.");
      return;
    }
    setTemplateId("");
    const reference = new RegExp(`(^|[^a-z0-9_])${fieldId}(?=$|[^a-z0-9_])`, "g");
    setTemplate((current) => ({
      ...current,
      fields: current.fields.map((field) => ({
        ...field,
        ...(field.id === fieldId ? { id: nextId } : {}),
        ...(field.expression ? { expression: field.expression.replace(reference, `$1${nextId}`) } : {}),
      })),
    }));
    setCalculated({});
    setRollResults({});
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
    updateField(field.id, {
      kind,
      character_name: kind === "text" && field.character_name === true,
      identity_kind: kind === "select" ? field.identity_kind : null,
      options: kind === "select" ? (field.options.length ? field.options : ["Opção 1"]) : [],
      expression: kind === "formula" ? (field.expression ?? "") : kind === "roll" ? (field.expression ?? "2d6") : null,
    });
  }

  function addField() {
    editorRevision.current += 1;
    setTemplateId("");
    let suffix = template.fields.length + 1;
    while (template.fields.some((field) => field.id === `campo_${suffix}`)) suffix += 1;
    const id = `campo_${suffix}`;
    setTemplate((current) => ({
      ...current,
      fields: [...current.fields, { id, label: "Novo campo", kind: "text", required: false, options: [], expression: null }],
    }));
    setValues((current) => ({ ...current, [id]: "" }));
    setFeedback("");
  }

  function removeField(fieldId: string) {
    editorRevision.current += 1;
    setTemplateId("");
    setTemplate((current) => ({ ...current, fields: current.fields.filter((field) => field.id !== fieldId) }));
    setValues((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setCalculated({});
    setRollResults({});
  }

  function setValue(fieldId: string, value: FieldValue) {
    if (busy) return;
    editorRevision.current += 1;
    setValues((current) => ({ ...current, [fieldId]: value }));
    if (characterNameField(template)?.id === fieldId && typeof value === "string") setSheetName(value);
    setCalculated({});
    setRollResults({});
    setFeedback("");
  }

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

  function collectValues(partial = false): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const field of template.fields) {
      if (field.kind === "formula" || field.kind === "roll") continue;
      const value = characterNameField(template)?.id === field.id ? sheetName : values[field.id];

      if (field.kind === "number") {
        if (value === undefined || value === "") {
          if (field.required && !partial) throw new Error(`${field.label}: informe um número.`);
          continue;
        }
        if (typeof value !== "number" && typeof value !== "string") throw new Error(`${field.label}: informe um número válido.`);
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) throw new Error(`${field.label}: informe um número válido.`);
        output[field.id] = numberValue;
        continue;
      }

      if (field.kind === "checkbox") {
        const checked = value === true;
        if (field.required && !checked && !partial) throw new Error(`${field.label}: marque esta opção.`);
        output[field.id] = checked;
        continue;
      }

      if (field.kind === "collection") {
        const items = Array.isArray(value) ? value : [];
        if (field.required && items.length === 0 && !partial) throw new Error(`${field.label}: adicione ao menos um item.`);
        output[field.id] = items;
        continue;
      }

      const text = typeof value === "string" ? value.trim() : "";
      if (field.required && !text && !partial) throw new Error(`${field.label}: preencha este campo.`);
      if (field.kind === "select" && text && !field.options.includes(text)) throw new Error(`${field.label}: escolha uma opção do modelo.`);
      if (text) output[field.id] = text;
    }

    for (const field of template.fields.filter((item) => item.kind === "roll")) {
      if (!field.expression || !/^[1-9][0-9]?d[1-9][0-9]{0,3}(?:[+-][0-9]{1,5})?$/i.test(field.expression.replaceAll(" ", ""))) {
        throw new Error(`${field.label}: use uma rolagem como 2d6+3.`);
      }
    }
    return output;
  }

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL;
    if (!api) {
      setCalculationError(template.fields.some((field) => field.kind === "formula") ? "A API de cálculos não está configurada." : "");
      return;
    }
    let payloadValues: Record<string, unknown>;
    try {
      payloadValues = collectValues(true);
    } catch {
      setCalculated({});
      return;
    }
    if (!template.fields.some((field) => field.kind === "formula")) {
      setCalculated(payloadValues);
      setCalculationError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await authenticatedPost("/api/v1/sheets/calculate", { template, values: payloadValues }, controller.signal);
        if (!controller.signal.aborted) {
          setCalculated(result.values as Record<string, unknown>);
          setCalculationError("");
        }
      } catch {
        if (!controller.signal.aborted) {
          setCalculated({});
          setCalculationError("A prévia ainda não pôde ser calculada. Confira os campos numéricos e a conexão.");
        }
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [template, values, sheetName]);

  async function validateAndCalculate() {
    const api = process.env.NEXT_PUBLIC_API_URL;
    if (!api) {
      setFeedback("Configure NEXT_PUBLIC_API_URL para validar e calcular esta ficha.");
      return;
    }

    setBusy(true);
    const revision = editorRevision.current;
    const selection = selectedCharacterId.current;
    const rules = rollRules.current;
    const isCurrent = () => editorRevision.current === revision && selectedCharacterId.current === selection && rules === rollRules.current;
    setFeedback("");
    try {
      const payloadValues = collectValues();
      await authenticatedPost("/api/v1/templates/validate", template);
      if (!isCurrent()) return;

      const calculationPayload = await authenticatedPost("/api/v1/sheets/calculate", { template, values: payloadValues });
      if (!isCurrent()) return;
      const nextValues = calculationPayload.values as Record<string, unknown>;
      setCalculated(nextValues);

      const nextRolls: Record<string, RollResult> = {};
      for (const field of template.fields.filter((item) => item.kind === "roll")) {
        if (!isCurrent()) return;
        const result = await authenticatedPost("/api/v1/dice/roll", {
          expression: field.expression, context_tags: contextTags,
          effects: character?.id === sheetId ? character.effects : [],
        }) as { rolls: number[]; modifier: number; total: number; modifier_preview?: ModifierPreview };
        if (!isCurrent()) return;
        nextRolls[field.id] = { ...result, preview: result.modifier_preview };
      }
      setRollResults(nextRolls);
      setFeedback("Template validado. Prévia atualizada.");
    } catch (error) {
      if (isCurrent()) {
        setCalculated({}); setRollResults({});
        setFeedback(error instanceof Error ? error.message : "Não foi possível validar esta ficha.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content">
      <nav className="actions" aria-label="Modo das fichas">
        <button className={mode === "guided" ? "primary" : "quiet"} type="button" disabled={busy} aria-pressed={mode === "guided"} onClick={startCreation}>Criar personagem</button>
        <button className={mode === "editor" ? "primary" : "quiet"} type="button" disabled={busy} aria-pressed={mode === "editor"} onClick={() => setMode("editor")}>Fichas e modelos</button>
      </nav>
      {mode === "guided" && !sheetId ? <SheetCreationWizard
        key={templateId || "no-template"}
        templates={templates} templateId={templateId} template={template} values={values}
        name={sheetName} calculated={calculated} busy={busy} canCreate={canEditSheets}
        loading={loading} loadError={loadError} feedback={feedback} calculationError={templateId ? calculationError : ""}
        onChooseTemplate={chooseTemplate} onNameChange={changeCharacterName} onValueChange={setValue}
        onSave={saveSheet} onOpenEditor={canManageTemplates ? () => setMode("editor") : undefined}
      /> : <fieldset disabled={busy} style={{ border: 0, margin: "18px 0 0", padding: 0, minWidth: 0 }}><div className="sheet-layout">
      <div className="sheet-builder-column">
        <article className="sheet-template-card">
          <p className="eyebrow">FICHAS DA CAMPANHA</p>
          <h2>Modelos e personagens</h2>
          <div className="sheet-field-grid">
            <label>Modelo
              <select value={templateId} onChange={(event) => chooseTemplate(event.target.value)}>
                <option value="">{canManageTemplates ? "Novo modelo" : "Selecione um modelo"}</option>
                {templates.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}
              </select>
            </label>
            <label>Ficha existente
              <select value={sheetId} onChange={(event) => chooseSheet(event.target.value)}>
                <option value="">Nova ficha</option>
                {sheets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          </div>
          {templates.length === 0 && !canManageTemplates ? <p className="sheet-feedback">O mestre ainda não publicou um modelo nesta campanha.</p> : null}
          <label className="sheet-name">Nome do personagem
            <input value={sheetName} maxLength={120} onChange={(event) => changeCharacterName(event.target.value)} placeholder="Nome da ficha" />
          </label>
          <div className="actions">
            <button className="primary" type="button" onClick={saveSheet} disabled={busy || !templateId || !canEditSheets}>Salvar ficha</button>
            <button className="quiet" type="button" onClick={() => { chooseTemplate(templateId); setMode("guided"); }}>Nova ficha</button>
          </div>
        </article>
        <article className="sheet-intro">
          <div>
            <p className="eyebrow">OFICINA DE FICHAS / {templateId ? "MODELO SALVO" : "RASCUNHO"}</p>
            <h2>Monte a ficha da sua mesa.</h2>
          </div>
          <p>Os campos ficam em blocos independentes. Fórmulas são recalculadas pela API ao editar a ficha.</p>
        </article>

        {canManageTemplates && !sheetId ? <article className="sheet-template-card">
          <div className="actions">{SYSTEM_STARTERS.map(starter=><button className="quiet" type="button" key={starter.id} onClick={()=>loadStarter(starter.id)}>Base {starter.label}</button>)}</div>
          <div className="sheet-template-heading">
            <label className="sheet-name">Nome do template
              <input value={template.name} maxLength={120} onChange={(event) => { editorRevision.current += 1; setTemplateId(""); setTemplate((current) => ({ ...current, name: event.target.value })); }} />
            </label>
            <label className="sheet-version">Versão
              <input type="number" min={1} value={template.version} onChange={(event) => { editorRevision.current += 1; setTemplateId(""); setTemplate((current) => ({ ...current, version: Math.max(1, Number(event.target.value) || 1) })); }} />
            </label>
          </div>
          <label className="sheet-preview-input" style={{ marginTop: 16 }}>Identificador do sistema (opcional)
            <input value={template.system_key ?? ""} maxLength={64} placeholder="Ex.: vampire-v5 ou sistema-da-mesa" onChange={(event) => {
              editorRevision.current += 1;
              setTemplateId("");
              setTemplate((current) => ({ ...current, system_key: event.target.value || null }));
            }} />
          </label>

          <div className="sheet-fields-heading"><div><p className="eyebrow">ESTRUTURA</p><h3>Campos da ficha <span>{template.fields.length}</span></h3></div>
            <button className="quiet" type="button" onClick={addField}>Adicionar campo</button>
          </div>

          <div className="sheet-field-list">
            {template.fields.map((field, index) => (
              <fieldset className="sheet-field-card" key={`${field.id}-${index}`}>
                <legend>Campo {String(index + 1).padStart(2, "0")}</legend>
                <div className="sheet-field-grid">
                  <label>ID do campo
                    <input value={field.id} maxLength={64} pattern="[a-z][a-z0-9_]{1,63}" onChange={(event) => renameField(field.id, event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} />
                  </label>
                  <label>Rótulo
                    <input value={field.label} maxLength={120} onChange={(event) => updateField(field.id, { label: event.target.value })} />
                  </label>
                  <label>Tipo
                    <select value={field.kind} onChange={(event) => changeKind(field, event.target.value as FieldKind)}>
                      {fieldKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
                    </select>
                  </label>
                  <label className="sheet-required"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /> Obrigatório</label>
                  <label>Etapa da criação
                    <select value={field.creation_step ?? "other"} onChange={(event) => updateField(field.id, { creation_step: event.target.value as SheetField["creation_step"] })}>
                      {creationSteps.map((step) => <option key={step} value={step}>{stepLabels[step]}</option>)}
                    </select>
                  </label>
                  {field.kind === "select" && <label>Identidade em destaque
                    <select value={field.identity_kind ?? ""} onChange={(event) => updateField(field.id, { identity_kind: event.target.value as SheetField["identity_kind"] || null })}>
                      <option value="">Campo comum</option>{identityKinds.map((kind) => <option key={kind} value={kind}>{identityLabels[kind]}</option>)}
                    </select>
                  </label>}
                  {field.kind === "text" && <label className="sheet-required"><input type="checkbox" checked={field.character_name === true} onChange={(event) => {
                    editorRevision.current += 1;
                    setTemplateId("");
                    setTemplate((current) => ({ ...current, fields: current.fields.map((item) => ({ ...item, character_name: item.id === field.id ? event.target.checked : false })) }));
                  }} /> Nome do personagem</label>}

                  {field.kind === "select" && <label className="sheet-wide">Opções, uma por linha
                    <textarea rows={3} value={field.options.join("\n")} onChange={(event) => updateField(field.id, { options: event.target.value.split("\n").map((option) => option.trim()).filter(Boolean) })} />
                  </label>}

                  {(field.kind === "formula" || field.kind === "roll") && <label className="sheet-wide">Expressão
                    <input value={field.expression ?? ""} maxLength={120} spellCheck={false} onChange={(event) => updateField(field.id, { expression: event.target.value })} />
                    <small>{field.kind === "formula" ? "Aritmética e IDs de outros campos, por exemplo vigor + astucia." : "Formato aceito: NdM, com modificador opcional, por exemplo 2d6+3."}</small>
                  </label>}
                  <button className="sheet-remove" type="button" disabled={template.fields.length === 1} onClick={() => removeField(field.id)}>Remover campo</button>
                </div>
              </fieldset>
            ))}
          </div>
          <button className="primary" type="button" onClick={saveTemplate} disabled={busy || Boolean(templateId)}>{templateId ? "Modelo salvo" : "Salvar modelo na campanha"}</button>
        </article>
        : null}
      </div>

      <aside className="sheet-preview-card">
        <p className="eyebrow">PRÉVIA DA MESA</p>
        <h2>{template.name || "Ficha sem título"}</h2>
        <p className="sheet-preview-meta">Versão {template.version} <span>·</span> {template.fields.length} campos</p>

        <div className="sheet-preview-fields">
          {template.fields.map((field) => {
            if (characterNameField(template)?.id === field.id) return null;
            if (field.kind === "formula") {
              const result = calculated[field.id];
              return <div className="sheet-preview-value sheet-computed" key={field.id}><span>{field.label}<small>calculado</small></span><strong>{result === undefined ? "—" : String(result)}</strong></div>;
            }
            if (field.kind === "roll") {
              const result = rollResults[field.id];
              return <div className="sheet-preview-value sheet-computed" key={field.id}><span>{field.label}<small>{field.expression}</small>{result?.preview?.applied.map((effect) => <small key={effect.id} title={effect.source_note ?? effect.label}>{effect.delta >= 0 ? "+" : ""}{effect.delta} dados: {effect.label}</small>)}</span><strong>{result ? `${result.rolls.join(" + ")}${result.modifier ? ` ${result.modifier >= 0 ? "+" : "-"} ${Math.abs(result.modifier)}` : ""} = ${result.total}` : "..."}</strong></div>;
            }
            if (field.kind === "checkbox") {
              return <label className="sheet-preview-check" key={field.id}><input type="checkbox" checked={values[field.id] === true} onChange={(event) => setValue(field.id, event.target.checked)} />{field.label}</label>;
            }
            if (field.kind === "select") {
              return <label className="sheet-preview-input" key={field.id}>{field.label}
                <select value={typeof values[field.id] === "string" ? String(values[field.id]) : ""} onChange={(event) => setValue(field.id, event.target.value)}>
                  <option value="">Selecione</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>;
            }
            if (field.kind === "collection") {
              const items = Array.isArray(values[field.id]) ? (values[field.id] as unknown[]).filter((item): item is string => typeof item === "string") : [];
              return <div key={field.id}><label className="sheet-preview-input">{field.label}
                <textarea rows={3} value={items.join("\n")} onChange={(event) => setValue(field.id, event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} placeholder="Um item por linha" />
              </label>{["disciplinas", "vantagens"].includes(field.id) && <div className="sheet-compendium-links">{items.map((name, index) => <CompendiumReference key={`${name}-${index}`} name={name} />)}</div>}</div>;
            }
            return <label className="sheet-preview-input" key={field.id}>{field.label}
              <input type={field.kind === "number" ? "number" : "text"} value={typeof values[field.id] === "string" || typeof values[field.id] === "number" ? String(values[field.id]) : ""} onChange={(event) => setValue(field.id, event.target.value)} />
            </label>;
          })}
        </div>

        {template.fields.some((field) => field.kind === "collection" && ["disciplinas", "vantagens"].includes(field.id)) && <details><summary>Adicionar do compêndio</summary><CompendiumPanel selectedNames={[...(Array.isArray(values.disciplinas) ? values.disciplinas as string[] : []), ...(Array.isArray(values.vantagens) ? values.vantagens as string[] : [])].filter((name) => typeof name === "string")} onSelect={(name) => {
          const entry = findCompendiumEntry(name);
          const fieldId = entry?.type === "discipline" ? "disciplinas" : "vantagens";
          if (!template.fields.some((field) => field.id === fieldId && field.kind === "collection")) { setFeedback("O modelo não possui a coleção correspondente ao verbete."); return; }
          const current = Array.isArray(values[fieldId]) ? (values[fieldId] as unknown[]).filter((item): item is string => typeof item === "string") : [];
          setValue(fieldId, [...new Set([...current, name])]);
        }} /></details>}

        <button className="primary sheet-calculate" type="button" onClick={validateAndCalculate} disabled={busy}>
          {busy ? "Validando e rolando..." : "Validar e rolar dados"}
        </button>
        <p className={feedback.startsWith("Template validado") || feedback.startsWith("Ficha salva") || feedback.startsWith("Modelo salvo") ? "sheet-feedback success" : "sheet-feedback"} aria-live="polite">{feedback || "Os cálculos aparecem após preencher os campos. Dados só são rolados ao clicar no botão."}</p>
        <div className="sheet-api-note"><span>Σ</span><p>Fórmulas são calculadas no servidor. O editor não executa código do template.</p></div>
      </aside>
      </div></fieldset>}
    </section>
  );
}
