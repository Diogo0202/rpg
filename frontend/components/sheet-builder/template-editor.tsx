"use client";

import { SYSTEM_STARTERS } from "../../../shared/rules/system-starters";
import { creationSteps, fieldKinds, identityKinds, type FieldKind, type SheetField, type SheetTemplate } from "../../../shared/rules/sheet-template";
import { HomebrewClanEditor } from "../homebrew-clan-editor";
import { createsDependencyCycle, IDENTITY_LABELS, linesToList, possibleTemplateOptions, STEP_LABELS } from "./template-model";
import type { SheetBuilderState } from "./use-sheet-builder";

type FieldsApi = SheetBuilderState["fields"];

function DependencyCases({ template, field, fields }: { template: SheetTemplate; field: SheetField; fields: FieldsApi }) {
  const { dependency } = fields;
  if (!field.depends_on) return null;
  const parent = template.fields.find((candidate) => candidate.id === field.depends_on?.field_id) ?? field;
  const parentOptions = possibleTemplateOptions(parent);
  return <div className="sheet-wide sheet-dependency-cases">
    <p>Casos de opções</p>
    <small>Quando o valor controlador corresponder, estas opções substituem as opções fixas. Caso sem correspondência deixa o campo oculto.</small>
    {field.depends_on.cases.map((item, caseIndex) => <fieldset className="sheet-dependency-case" key={`${field.id}-case-${caseIndex}`}>
      <legend>Caso {caseIndex + 1}</legend>
      <label>Valor do campo controlador
        <select value={item.equals} onChange={(event) => dependency.updateCase(field.id, caseIndex, { equals: event.target.value })}>
          <option value="">Selecione uma opção</option>
          {parentOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          {item.equals && !parentOptions.includes(item.equals) && <option value={item.equals}>{item.equals} (fora das opções atuais)</option>}
        </select>
      </label>
      <label>Opções disponíveis, uma por linha
        <textarea rows={3} value={item.options.join("\n")} onChange={(event) => dependency.updateCase(field.id, caseIndex, { options: linesToList(event.target.value) })} />
      </label>
      <button className="sheet-remove" type="button" onClick={() => dependency.removeCase(field.id, caseIndex)}>Remover caso</button>
    </fieldset>)}
    <button className="quiet" type="button" onClick={() => dependency.addCase(field.id)}>Adicionar caso</button>
  </div>;
}

function FieldCard({ template, field, index, fields }: { template: SheetTemplate; field: SheetField; index: number; fields: FieldsApi }) {
  const { updateField } = fields;
  return <fieldset className="sheet-field-card">
    <legend>Campo {String(index + 1).padStart(2, "0")}</legend>
    <div className="sheet-field-grid">
      <label>ID do campo
        <input value={field.id} maxLength={64} pattern="[a-z][a-z0-9_]{1,63}" onChange={(event) => fields.renameField(field.id, event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} />
      </label>
      <label>Rótulo
        <input value={field.label} maxLength={120} onChange={(event) => updateField(field.id, { label: event.target.value })} />
      </label>
      <label>Tipo
        <select value={field.kind} onChange={(event) => fields.changeKind(field, event.target.value as FieldKind)}>
          {fieldKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
        </select>
      </label>
      <label className="sheet-required"><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /> Obrigatório</label>
      <label>Etapa da criação
        <select value={field.creation_step ?? "other"} onChange={(event) => updateField(field.id, { creation_step: event.target.value as SheetField["creation_step"] })}>
          {creationSteps.map((step) => <option key={step} value={step}>{STEP_LABELS[step]}</option>)}
        </select>
      </label>
      {field.kind === "select" && <label>Identidade em destaque
        <select value={field.identity_kind ?? ""} onChange={(event) => updateField(field.id, { identity_kind: event.target.value as SheetField["identity_kind"] || null })}>
          <option value="">Campo comum</option>{identityKinds.map((kind) => <option key={kind} value={kind}>{IDENTITY_LABELS[kind]}</option>)}
        </select>
      </label>}
      {field.kind === "text" && <label className="sheet-required"><input type="checkbox" checked={field.character_name === true} onChange={(event) => fields.markCharacterNameField(field.id, event.target.checked)} /> Nome do personagem</label>}

      {field.kind === "select" && <>
        <label className="sheet-wide">Campo controlador (opcional)
          <select value={field.depends_on?.field_id ?? ""} onChange={(event) => fields.dependency.configure(field.id, event.target.value)}>
            <option value="">Sem dependência</option>
            {template.fields.filter((candidate) => candidate.kind === "select" && candidate.id !== field.id && !createsDependencyCycle(template, field.id, candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} ({candidate.id})</option>)}
          </select>
          <small>O campo aparece quando a escolha controladora tiver um caso configurado.</small>
        </label>
        {!field.depends_on && <label className="sheet-wide">Opções, uma por linha
          <textarea rows={3} value={field.options.join("\n")} onChange={(event) => updateField(field.id, { options: linesToList(event.target.value) })} />
        </label>}
        <DependencyCases template={template} field={field} fields={fields} />
      </>}

      {(field.kind === "formula" || field.kind === "roll") && <label className="sheet-wide">Expressão
        <input value={field.expression ?? ""} maxLength={120} spellCheck={false} onChange={(event) => updateField(field.id, { expression: event.target.value })} />
        <small>{field.kind === "formula" ? "Aritmética e IDs de outros campos, por exemplo vigor + astucia." : "Formato aceito: NdM, com modificador opcional, por exemplo 2d6+3."}</small>
      </label>}
      <button className="sheet-remove" type="button" disabled={template.fields.length === 1} onClick={() => fields.removeField(field.id)}>Remover campo</button>
    </div>
  </fieldset>;
}

/** Editor de modelo do narrador: bases de sistema, metadados, clãs próprios e campos. */
export function TemplateEditor({ builder }: { builder: SheetBuilderState }) {
  const { template, templateId, busy, fields } = builder;
  return <article className="sheet-template-card">
    <div className="actions">{SYSTEM_STARTERS.map((starter) => <button className="quiet" type="button" key={starter.id} onClick={() => builder.loadStarter(starter.id)}>Base {starter.label}</button>)}</div>
    <div className="sheet-template-heading">
      <label className="sheet-name">Nome do template
        <input value={template.name} maxLength={120} onChange={(event) => fields.editTemplate((current) => ({ ...current, name: event.target.value }))} />
      </label>
      <label className="sheet-version">Versão
        <input type="number" min={1} value={template.version} onChange={(event) => fields.editTemplate((current) => ({ ...current, version: Math.max(1, Number(event.target.value) || 1) }))} />
      </label>
    </div>
    <label className="sheet-preview-input" style={{ marginTop: 16 }}>Identificador do sistema (opcional)
      <input value={template.system_key ?? ""} maxLength={64} placeholder="Ex.: vampire-v5 ou sistema-da-mesa" onChange={(event) => fields.editTemplate((current) => ({ ...current, system_key: event.target.value || null }))} />
    </label>

    <HomebrewClanEditor template={template} onChange={(next) => fields.editTemplate(() => next)} />

    <div className="sheet-fields-heading"><div><p className="eyebrow">ESTRUTURA</p><h3>Campos da ficha <span>{template.fields.length}</span></h3></div>
      <button className="quiet" type="button" onClick={fields.addField}>Adicionar campo</button>
    </div>

    <div className="sheet-field-list">
      {template.fields.map((field, index) => <FieldCard key={`${field.id}-${index}`} template={template} field={field} index={index} fields={fields} />)}
    </div>
    <button className="primary" type="button" onClick={builder.saveTemplate} disabled={busy || Boolean(templateId)}>{templateId ? "Modelo salvo" : "Salvar modelo na campanha"}</button>
  </article>;
}
