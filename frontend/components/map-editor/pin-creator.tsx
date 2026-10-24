"use client";

import { useId, useState, type FormEvent } from "react";

import type { MapPin, PinKind, PinSize } from "../../lib/map-document";
import type { MapKit, PinIcon } from "../../lib/map-kits";
import { PortraitAvatar } from "../portrait-picker";
import styles from "./map-editor.module.css";

export type SheetOption = { id: string; name: string; portrait_path: string | null };
export type EntityOption = { id: string; name: string; kind: "npc" | "item" };

const RING_COLORS = ["#d6b15d", "#b55b32", "#83a89a", "#a16b8d", "#7397b5", "#e3e0d8"];
const KIND_LABELS: Record<PinKind, string> = { character: "Personagem", npc: "NPC", item: "Item" };
const SIZE_LABELS: Record<PinSize, string> = { small: "Pequeno", medium: "Médio", large: "Grande" };

function IconPreview({ icon }: { icon: PinIcon }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={icon.path} fill="currentColor" /></svg>;
}

type Props = {
  kit: MapKit;
  pin: MapPin;
  sheets: SheetOption[];
  entities: EntityOption[];
  portraitUrls: Record<string, string>;
  /** Sheets already on the map; each character gets one pin. */
  placedSheetIds: Set<string>;
  onSubmit: (pin: MapPin) => void;
  onCancel: () => void;
  onCreateEntity: (kind: "npc" | "item", name: string) => Promise<EntityOption>;
  isNew: boolean;
};

/**
 * Character pins come from the campaign sheets and show the photo sent at
 * sheet creation. NPC and item pins use the system kit icons and may link a
 * world entity so the same NPC is reused across maps.
 */
export function PinCreator({ kit, pin, sheets, entities, portraitUrls, placedSheetIds, onSubmit, onCancel, onCreateEntity, isNew }: Props) {
  const uid = useId();
  const [draft, setDraft] = useState<MapPin>(pin);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const icons = draft.kind === "npc" ? kit.npcIcons : kit.itemIcons;
  const availableSheets = sheets.filter((sheet) => sheet.portrait_path && (!placedSheetIds.has(sheet.id) || sheet.id === pin.sheet_id));
  const linkable = entities.filter((entity) => entity.kind === draft.kind);

  function setKind(kind: PinKind) {
    const nextIcons = kind === "npc" ? kit.npcIcons : kit.itemIcons;
    setDraft((current) => ({
      ...current, kind,
      sheet_id: kind === "character" ? current.sheet_id : undefined,
      entity_id: kind === "character" ? undefined : current.entity_id,
      icon: kind === "character" ? undefined : current.icon && nextIcons.some((icon) => icon.id === current.icon) ? current.icon : nextIcons[0]?.id,
    }));
    setError("");
  }

  function chooseSheet(sheet: SheetOption) {
    setDraft((current) => ({ ...current, sheet_id: sheet.id, label: sheet.name.slice(0, 120) }));
    setError("");
  }

  async function createEntity() {
    const name = draft.label.trim();
    if (draft.kind === "character" || !name || creating) { setError("Informe o nome antes de criar a ficha do NPC ou item."); return; }
    setCreating(true);
    try {
      const entity = await onCreateEntity(draft.kind, name);
      setDraft((current) => ({ ...current, entity_id: entity.id }));
      setError("");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Não foi possível criar a entidade.");
    } finally { setCreating(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = draft.label.trim();
    if (draft.kind === "character" && !draft.sheet_id) { setError("Escolha a ficha do personagem."); return; }
    if (!label || label.length > 120) { setError("Dê um nome de até 120 caracteres ao pin."); return; }
    const notes = draft.notes?.trim();
    onSubmit({ ...draft, label, ...(notes ? { notes } : { notes: undefined }) });
  }

  return <form className={styles.card} onSubmit={submit} aria-labelledby={`${uid}-title`}>
    <h3 id={`${uid}-title`}>{isNew ? "Novo pin" : "Editar pin"}</h3>
    <div className={styles.row} role="group" aria-label="Tipo de pin">
      {(Object.keys(KIND_LABELS) as PinKind[]).map((kind) => <button key={kind} type="button" className={styles.tool} aria-pressed={draft.kind === kind} onClick={() => setKind(kind)}>{KIND_LABELS[kind]}</button>)}
    </div>

    {draft.kind === "character" && <div className={styles.list} role="group" aria-label="Ficha do personagem">
      {availableSheets.length === 0 && <p className={styles.hint}>Nenhuma ficha com retrato disponível. O retrato é enviado na criação da ficha.</p>}
      {availableSheets.map((sheet) => <button key={sheet.id} type="button" className={styles.sheetChoice} aria-pressed={draft.sheet_id === sheet.id} onClick={() => chooseSheet(sheet)}>
        <PortraitAvatar url={sheet.portrait_path ? portraitUrls[sheet.portrait_path] : undefined} name={sheet.name} size={40} /><span>{sheet.name}</span>
      </button>)}
    </div>}

    <label>Nome no mapa<input value={draft.label} maxLength={120} onChange={(event) => setDraft({ ...draft, label: event.target.value })} required /></label>

    {draft.kind !== "character" && <>
      <div className={styles.palette} role="group" aria-label="Ícone">
        {icons.map((icon) => <button key={icon.id} type="button" className={styles.paletteItem} aria-pressed={draft.icon === icon.id} onClick={() => setDraft({ ...draft, icon: icon.id })}><IconPreview icon={icon} />{icon.label}</button>)}
      </div>
      <label>Vincular a {draft.kind === "npc" ? "NPC do mundo" : "item do mundo"}
        <select value={draft.entity_id ?? ""} onChange={(event) => setDraft({ ...draft, entity_id: event.target.value || undefined })}>
          <option value="">Sem vínculo</option>
          {linkable.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
        </select>
      </label>
      {!draft.entity_id && <button type="button" className={styles.tool} disabled={creating || !draft.label.trim()} onClick={() => void createEntity()}>{creating ? "Criando…" : `Criar ${draft.kind === "npc" ? "NPC" : "item"} no mundo com este nome`}</button>}
      <label>Nota do Mestre<textarea maxLength={2000} value={draft.notes ?? ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    </>}

    <fieldset className={styles.row} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className={styles.hint}>Tamanho</legend>
      {(Object.keys(SIZE_LABELS) as PinSize[]).map((size) => <button key={size} type="button" className={styles.tool} aria-pressed={(draft.size ?? "medium") === size} onClick={() => setDraft({ ...draft, size })}>{SIZE_LABELS[size]}</button>)}
    </fieldset>
    <fieldset className={styles.swatches} style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className={styles.hint}>Cor do anel</legend>
      {RING_COLORS.map((color) => <button key={color} type="button" className={styles.swatch} style={{ backgroundColor: color }} aria-label={`Anel ${color}`} aria-pressed={draft.ring_color === color} onClick={() => setDraft({ ...draft, ring_color: color })} />)}
    </fieldset>
    <label className={styles.check}><input type="checkbox" checked={draft.gm_only} onChange={(event) => setDraft({ ...draft, gm_only: event.target.checked })} />Só o Mestre vê este pin</label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.row}>
      <button className={`${styles.tool} ${styles.primary}`} type="submit">{isNew ? "Colocar no mapa" : "Salvar pin"}</button>
      <button className={styles.tool} type="button" onClick={onCancel}>Cancelar</button>
    </div>
  </form>;
}
