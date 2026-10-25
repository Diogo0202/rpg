"use client";

import { useState } from "react";

import { addHomebrewClan, grantRules, homebrewClans, parsePowerLines, powerRules, removeHomebrewClan, type HomebrewDiscipline } from "../lib/creation-grants";
import type { SheetTemplate } from "../lib/sheet-template";

type DraftDiscipline = { label: string; powers: string; rituals: string };

/**
 * Template-editor panel for homebrew clans: the clan joins the clan list, its
 * disciplines land at one dot when it is chosen, and a new discipline brings its
 * own locked power and ritual lists ("nível | nome", one per line).
 */
export function HomebrewClanEditor({ template, onChange }: { template: SheetTemplate; onChange: (next: SheetTemplate) => void }) {
  const clanRule = grantRules(template).find((rule) => template.fields.find((field) => field.id === rule.field)?.identity_kind === "clan");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<DraftDiscipline[]>([]);
  const [message, setMessage] = useState("");
  if (!clanRule) return null;

  const sources = powerRules(template).find((rule) => rule.collection === "disciplinas")?.sources ?? [];
  const disciplines = clanRule.fields.map((id) => ({ id, label: template.fields.find((field) => field.id === id)?.label ?? id, powers: sources.find((source) => source.field === id)?.powers.length ?? 0 }));
  const total = picked.length + drafts.length;

  function save() {
    try {
      const newDisciplines: HomebrewDiscipline[] = drafts.map((draft) => ({ label: draft.label, powers: parsePowerLines(draft.powers), rituals: parsePowerLines(draft.rituals) }));
      if (newDisciplines.some((item) => item.powers.length === 0)) throw new Error("Cada disciplina nova precisa de ao menos um poder no formato nível | nome.");
      onChange(addHomebrewClan(template, { name, disciplines: picked, newDisciplines }));
      setMessage(`Clã ${name.trim()} adicionado. Salve o modelo para usar na criação.`);
      setName(""); setPicked([]); setDrafts([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível adicionar o clã.");
    }
  }

  return <fieldset className="sheet-field-card homebrew-clans">
    <legend>Clãs homebrew</legend>
    <p className="homebrew-intro">Um clã criado aqui aparece na criação junto dos oficiais. Ao escolhê-lo, cada disciplina dele entra com 1 ponto e os poderes ficam presos à lista cadastrada.</p>
    {homebrewClans(template).length > 0 && <ul className="homebrew-list">
      {homebrewClans(template).map((item) => <li key={item.equals}>
        <span><strong>{item.equals}</strong> · {Object.keys(item.add ?? {}).map((id) => template.fields.find((field) => field.id === id)?.label ?? id).join(", ")}</span>
        <button className="sheet-remove" type="button" onClick={() => { onChange(removeHomebrewClan(template, item.equals)); setMessage(`Clã ${item.equals} removido.`); }}>Remover</button>
      </li>)}
    </ul>}
    <div className="sheet-field-grid">
      <label className="sheet-wide">Nome do clã<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Filhos da Fuligem" /></label>
      <div className="sheet-wide">
        <p className="homebrew-subtitle">Disciplinas do clã <span>{total} escolhidas</span></p>
        <div className="homebrew-disciplines">
          {disciplines.map((item) => <label className="sheet-required" key={item.id}>
            <input type="checkbox" checked={picked.includes(item.id)} onChange={(event) => setPicked((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />
            {item.label}{item.powers === 0 ? " (sem lista de poderes)" : ""}
          </label>)}
        </div>
      </div>
      {drafts.map((draft, index) => <fieldset className="sheet-dependency-case sheet-wide" key={index}>
        <legend>Disciplina nova {index + 1}</legend>
        <label>Nome<input value={draft.label} maxLength={60} onChange={(event) => setDrafts((current) => current.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} /></label>
        <label>Poderes, um por linha no formato nível | nome
          <textarea rows={4} value={draft.powers} placeholder={"1 | Névoa de Brasas\n2 | Pulmões de Ferro"} onChange={(event) => setDrafts((current) => current.map((item, position) => position === index ? { ...item, powers: event.target.value } : item))} />
        </label>
        <label>Rituais (opcional), mesmo formato
          <textarea rows={3} value={draft.rituals} placeholder="1 | Selo da Caldeira" onChange={(event) => setDrafts((current) => current.map((item, position) => position === index ? { ...item, rituals: event.target.value } : item))} />
        </label>
        <button className="sheet-remove" type="button" onClick={() => setDrafts((current) => current.filter((_, position) => position !== index))}>Remover disciplina nova</button>
      </fieldset>)}
      <div className="actions sheet-wide">
        <button className="quiet" type="button" onClick={() => setDrafts((current) => [...current, { label: "", powers: "", rituals: "" }])}>Criar disciplina nova</button>
        <button className="primary" type="button" disabled={!name.trim() || total === 0} onClick={save}>Adicionar clã</button>
      </div>
    </div>
    {message && <p className="sheet-feedback" aria-live="polite">{message}</p>}
  </fieldset>;
}
