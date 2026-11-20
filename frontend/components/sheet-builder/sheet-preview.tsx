"use client";

import { chronicleActivityLabel } from "../../lib/chronicle-context";
import { characterNameField, type SheetField } from "../../../shared/rules/sheet-template";
import { fieldOptions, isFieldActive } from "../../../shared/rules/sheet-creation";
import { CompendiumPanel, CompendiumReference } from "../compendium-panel";
import { COMPENDIUM_COLLECTIONS, linesToList, stringItems } from "./template-model";
import type { RollResult, SheetBuilderState } from "./use-sheet-builder";

const SUCCESS_PREFIXES = ["Template validado", "Ficha salva", "Modelo salvo"];

function rollText(result: RollResult | undefined): string {
  if (!result) return "...";
  const modifier = result.modifier ? ` ${result.modifier >= 0 ? "+" : "-"} ${Math.abs(result.modifier)}` : "";
  return `${result.rolls.join(" + ")}${modifier} = ${result.total}`;
}

function PreviewField({ builder, field }: { builder: SheetBuilderState; field: SheetField }) {
  const { template, values, calculated, rollResults, setValue } = builder;
  const value = values[field.id];
  if (field.kind === "formula") {
    const result = calculated[field.id];
    return <div className="sheet-preview-value sheet-computed"><span>{field.label}<small>calculado</small></span><strong>{result === undefined ? "—" : String(result)}</strong></div>;
  }
  if (field.kind === "roll") {
    const result = rollResults[field.id];
    const activity = result?.chronicle ? chronicleActivityLabel(result.chronicle) : null;
    return <div className="sheet-preview-value sheet-computed"><span>{field.label}<small>{field.expression}</small>{activity && <small>{activity}</small>}{result?.preview?.applied.map((effect) => <small key={effect.id} title={effect.source_note ?? effect.label}>{effect.delta >= 0 ? "+" : ""}{effect.delta} dados: {effect.label}</small>)}</span><strong>{rollText(result)}</strong></div>;
  }
  if (field.kind === "checkbox") {
    return <label className="sheet-preview-check"><input type="checkbox" checked={value === true} onChange={(event) => setValue(field.id, event.target.checked)} />{field.label}</label>;
  }
  if (field.kind === "select") {
    return <label className="sheet-preview-input">{field.label}
      <select value={typeof value === "string" ? value : ""} onChange={(event) => setValue(field.id, event.target.value)}>
        <option value="">Selecione</option>{fieldOptions(template, field, values).map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>;
  }
  if (field.kind === "collection") {
    const items = stringItems(value);
    return <div><label className="sheet-preview-input">{field.label}
      <textarea rows={3} value={items.join("\n")} onChange={(event) => setValue(field.id, linesToList(event.target.value))} placeholder="Um item por linha" />
    </label>{COMPENDIUM_COLLECTIONS.includes(field.id) && <div className="sheet-compendium-links">{items.map((name, index) => <CompendiumReference key={`${name}-${index}`} name={name} />)}</div>}</div>;
  }
  return <label className="sheet-preview-input">{field.label}
    <input type={field.kind === "number" ? "number" : "text"} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onChange={(event) => setValue(field.id, event.target.value)} />
  </label>;
}

/** Prévia da ficha como a mesa vê, com cálculo, rolagens de teste e compêndio. */
export function SheetPreview({ builder, campaignId, viewerId }: { builder: SheetBuilderState; campaignId: string; viewerId: string }) {
  const { template, values, busy, feedback } = builder;
  const nameFieldId = characterNameField(template)?.id;
  const hasCompendium = template.fields.some((field) => field.kind === "collection" && COMPENDIUM_COLLECTIONS.includes(field.id));
  return <aside className="sheet-preview-card">
    <p className="eyebrow">PRÉVIA DA MESA</p>
    <h2>{template.name || "Ficha sem título"}</h2>
    <p className="sheet-preview-meta">Versão {template.version} <span>·</span> {template.fields.length} campos</p>

    <div className="sheet-preview-fields">
      {template.fields.filter((field) => isFieldActive(template, field, values) && field.id !== nameFieldId).map((field) => <PreviewField key={field.id} builder={builder} field={field} />)}
    </div>

    {hasCompendium && <details><summary>Adicionar do compêndio</summary><CompendiumPanel campaignId={campaignId} viewerId={viewerId}
      selectedNames={[...stringItems(values.disciplinas), ...stringItems(values.vantagens)]} onSelect={builder.addFromCompendium} /></details>}

    <button className="primary sheet-calculate" type="button" onClick={builder.validateAndCalculate} disabled={busy}>
      {busy ? "Validando e rolando..." : "Validar e rolar dados"}
    </button>
    <p className={SUCCESS_PREFIXES.some((prefix) => feedback.startsWith(prefix)) ? "sheet-feedback success" : "sheet-feedback"} aria-live="polite">{feedback || "Os cálculos aparecem após preencher os campos. Dados só são rolados ao clicar no botão."}</p>
    <div className="sheet-api-note"><span>Σ</span><p>Fórmulas são calculadas no servidor. O editor não executa código do template.</p></div>
  </aside>;
}
