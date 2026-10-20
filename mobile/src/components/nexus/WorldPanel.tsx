import { useMemo, useState, type FormEvent } from "react";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { JsonValue } from "@/lib/mobile-sync/index.ts";
import { useNexus, type Entity, type PathSet } from "@/lib/nexus/store";
import { Btn, Empty, Panel, Tag } from "./ui";

type WorldData = { kind: string; name: string; description: string; tags: string[] };
type MapData = { name: string; columns: number; rows: number; description: string };
type PinData = { map_id: string; label: string; x: number; y: number; note: string };
type WorldDraft = { id?: string; kind: string; name: string; description: string; tags: string };
type MapDraft = { id?: string; name: string; columns: string; rows: string; description: string };
type PinDraft = { id?: string; mapId: string; label: string; x: string; y: string; note: string };

const KIND_OPTIONS = ["npc", "local", "fação", "objeto", "ameaça", "criatura"];
const entityFields: (keyof WorldData)[] = ["kind", "name", "description", "tags"];
const mapFields: (keyof MapData)[] = ["name", "columns", "rows", "description"];

function parseTags(input: string): string[] {
  const tags = [...new Set(input.split(",").map((tag) => tag.trim()).filter(Boolean))];
  if (tags.length > 12) throw new Error("Use no máximo 12 tags.");
  if (tags.some((tag) => tag.length > 40)) throw new Error("Cada tag pode ter até 40 caracteres.");
  return tags;
}

function checkedWorld(draft: WorldDraft): WorldData {
  const name = draft.name.trim(), description = draft.description.trim(), tags = parseTags(draft.tags);
  if (name.length < 2 || name.length > 120) throw new Error("O nome precisa ter entre 2 e 120 caracteres.");
  if (!KIND_OPTIONS.includes(draft.kind)) throw new Error("Escolha um tipo válido.");
  if (description.length > 3000) throw new Error("A descrição pode ter até 3.000 caracteres.");
  return { kind: draft.kind, name, description, tags };
}

function checkedMap(draft: MapDraft): MapData {
  const name = draft.name.trim(), description = draft.description.trim();
  if (name.length < 2 || name.length > 120) throw new Error("O nome do mapa precisa ter entre 2 e 120 caracteres.");
  if (!/^\d+$/.test(draft.columns) || !/^\d+$/.test(draft.rows)) throw new Error("Colunas e linhas precisam ser números inteiros.");
  const columns = Number(draft.columns), rows = Number(draft.rows);
  if (columns < 2 || columns > 40 || rows < 2 || rows > 40) throw new Error("Use de 2 a 40 colunas e de 2 a 40 linhas.");
  if (description.length > 2000) throw new Error("A descrição pode ter até 2.000 caracteres.");
  return { name, columns, rows, description };
}

function checkedPin(draft: PinDraft): Omit<PinData, "map_id"> {
  const label = draft.label.trim(), note = draft.note.trim();
  if (!draft.mapId) throw new Error("Escolha um mapa.");
  if (label.length < 1 || label.length > 120) throw new Error("O rótulo precisa ter até 120 caracteres.");
  if (note.length > 1000) throw new Error("A nota pode ter até 1.000 caracteres.");
  if (draft.x.trim() === "" || draft.y.trim() === "") throw new Error("Informe as coordenadas do marcador.");
  const x = Number(draft.x), y = Number(draft.y);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) throw new Error("As coordenadas devem ficar entre 0 e 1.");
  return { label, x, y, note };
}

function sets<T extends object>(data: T, fields: readonly (keyof T)[]): PathSet[] {
  return fields.map((key) => ({ path: [String(key)], value: data[key] as JsonValue }));
}

function worldDraft(entity?: Entity<WorldData>): WorldDraft {
  return entity ? { id: entity.id, kind: entity.data.kind, name: entity.data.name, description: entity.data.description ?? "", tags: Array.isArray(entity.data.tags) ? entity.data.tags.join(", ") : "" }
    : { kind: "npc", name: "", description: "", tags: "" };
}
function mapDraft(map?: Entity<MapData>): MapDraft {
  return map ? { id: map.id, name: map.data.name, columns: String(map.data.columns), rows: String(map.data.rows), description: map.data.description ?? "" }
    : { name: "", columns: "12", rows: "9", description: "" };
}

export function WorldPanel() {
  const { list, get, create, update, remove } = useNexus();
  const entities = list<WorldData>("world_entities").sort((a, b) => a.data.name.localeCompare(b.data.name, "pt-BR"));
  const maps = list<MapData>("maps").sort((a, b) => a.data.name.localeCompare(b.data.name, "pt-BR"));
  const pins = list<PinData>("map_pins");
  const [selectedMapId, setSelectedMapId] = useState("");
  const activeMap = get<MapData>("maps", selectedMapId) ?? maps[0];
  const activePins = useMemo(() => pins.filter((pin) => pin.data.map_id === activeMap?.id), [pins, activeMap?.id]);
  const [worldForm, setWorldForm] = useState<WorldDraft | null>(null);
  const [mapForm, setMapForm] = useState<MapDraft | null>(null);
  const [pinForm, setPinForm] = useState<PinDraft | null>(null);
  const [zoom, setZoom] = useState(100);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const saveWorld = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!worldForm) return;
    setBusy(true); setError("");
    try {
      const value = checkedWorld(worldForm);
      if (worldForm.id) await update("world_entities", worldForm.id, sets(value, entityFields));
      else await create("world_entities", value as unknown as Record<string, JsonValue>);
      setWorldForm(null); setStatus("Entidade guardada neste aparelho.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível guardar a entidade."); }
    finally { setBusy(false); }
  };

  const deleteWorld = async (entity: Entity<WorldData>) => {
    if (!window.confirm(`Excluir “${entity.data.name}” deste aparelho?`)) return;
    setError("");
    try { await remove("world_entities", entity.id); setStatus("Entidade removida deste aparelho."); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível excluir a entidade."); }
  };

  const saveMap = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!mapForm) return;
    setBusy(true); setError("");
    try {
      const value = checkedMap(mapForm);
      if (mapForm.id) await update("maps", mapForm.id, sets(value, mapFields));
      else {
        const id = await create("maps", value as unknown as Record<string, JsonValue>);
        setSelectedMapId(id);
      }
      setMapForm(null); setStatus("Mapa guardado neste aparelho.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível guardar o mapa."); }
    finally { setBusy(false); }
  };

  const deleteMap = async (map: Entity<MapData>) => {
    if (!window.confirm(`Excluir “${map.data.name}” e seus marcadores deste aparelho?`)) return;
    setError("");
    try {
      for (const pin of pins.filter((item) => item.data.map_id === map.id)) await remove("map_pins", pin.id);
      await remove("maps", map.id);
      if (selectedMapId === map.id) setSelectedMapId("");
      setPinForm(null); setStatus("Mapa e marcadores removidos deste aparelho.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível excluir o mapa."); }
  };

  const savePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!pinForm) return;
    setBusy(true); setError("");
    try {
      const value = checkedPin(pinForm);
      if (pinForm.id) await update("map_pins", pinForm.id, sets(value, ["label", "x", "y", "note"]));
      else await create("map_pins", { ...value, map_id: pinForm.mapId }, { dependsOnEntities: [["maps", pinForm.mapId]] });
      setPinForm(null); setStatus("Marcador guardado neste aparelho.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível guardar o marcador."); }
    finally { setBusy(false); }
  };

  const deletePin = async (pin: Entity<PinData>) => {
    if (!window.confirm(`Excluir o marcador “${pin.data.label}”?`)) return;
    setError("");
    try { await remove("map_pins", pin.id); setStatus("Marcador removido deste aparelho."); if (pinForm?.id === pin.id) setPinForm(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível excluir o marcador."); }
  };

  return <div className="space-y-4">
    <Panel title="Entidades" actions={<Btn type="button" onClick={() => { setWorldForm(worldDraft()); setError(""); }}><Plus className="size-4" aria-hidden />Nova entidade</Btn>}>
      <p className="mb-3 text-sm text-ink-muted">NPCs, lugares, facções e outros registros guardados neste aparelho.</p>
      {!entities.length ? <Empty>Nenhuma entidade cadastrada.</Empty> : <ul className="space-y-2">
        {entities.map((entity) => <li key={entity.id} className="parchment-inset p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0"><p className="break-words font-semibold text-ink">{entity.data.name}</p><p className="text-xs capitalize text-ink-muted">{entity.data.kind}{entity.pending ? " · pendente local" : ""}{entity.conflict ? " · conflito" : ""}</p></div>
            <div className="flex gap-1"><Btn type="button" size="icon" variant="ghost" aria-label={`Editar ${entity.data.name}`} onClick={() => { setWorldForm(worldDraft(entity)); setError(""); }}><Pencil className="size-4" aria-hidden /></Btn><Btn type="button" size="icon" variant="ghost" aria-label={`Excluir ${entity.data.name}`} onClick={() => void deleteWorld(entity)}><Trash2 className="size-4" aria-hidden /></Btn></div>
          </div>
          {entity.data.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-ink">{entity.data.description}</p>}
          {!!entity.data.tags?.length && <div className="mt-2 flex flex-wrap gap-1">{entity.data.tags.map((tag, index) => <Tag key={`${tag}-${index}`}>{tag}</Tag>)}</div>}
        </li>)}
      </ul>}
      {worldForm && <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={(event) => void saveWorld(event)}>
        <h3 className="font-semibold text-ink">{worldForm.id ? "Editar entidade" : "Nova entidade"}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-ink">Tipo<select className="field-input mt-1" value={worldForm.kind} onChange={(event) => setWorldForm({ ...worldForm, kind: event.target.value })}>{KIND_OPTIONS.map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          <label className="text-sm font-semibold text-ink">Nome<input className="field-input mt-1" value={worldForm.name} maxLength={120} required onChange={(event) => setWorldForm({ ...worldForm, name: event.target.value })} /></label>
        </div>
        <label className="block text-sm font-semibold text-ink">Descrição<textarea className="field-input mt-1" rows={3} maxLength={3000} value={worldForm.description} onChange={(event) => setWorldForm({ ...worldForm, description: event.target.value })} /></label>
        <label className="block text-sm font-semibold text-ink">Tags, separadas por vírgula<input className="field-input mt-1" value={worldForm.tags} maxLength={520} placeholder="rio, aliada" onChange={(event) => setWorldForm({ ...worldForm, tags: event.target.value })} /></label>
        <div className="flex flex-wrap gap-2"><Btn type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar entidade"}</Btn><Btn type="button" variant="outline" disabled={busy} onClick={() => setWorldForm(null)}>Cancelar</Btn></div>
      </form>}
    </Panel>

    <Panel title="Mapas" actions={<Btn type="button" onClick={() => { setMapForm(mapDraft()); setError(""); }}><Plus className="size-4" aria-hidden />Novo mapa</Btn>}>
      {!maps.length ? <Empty>Nenhum mapa cadastrado.</Empty> : <div className="space-y-3">
        <label className="block text-sm font-semibold text-ink">Mapa selecionado<select className="field-input mt-1" value={activeMap?.id ?? ""} onChange={(event) => { setSelectedMapId(event.target.value); setPinForm(null); }}>
          {maps.map((map) => <option key={map.id} value={map.id}>{map.data.name}</option>)}
        </select></label>
        {activeMap && <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h3 className="font-semibold text-ink">{activeMap.data.name}</h3><p className="text-xs text-ink-muted">{activeMap.data.columns} × {activeMap.data.rows} · grid local</p></div>
            <div className="flex gap-1"><Btn type="button" size="sm" variant="outline" onClick={() => { setMapForm(mapDraft(activeMap)); setError(""); }}><Pencil className="size-4" aria-hidden />Editar</Btn><Btn type="button" size="icon" variant="ghost" aria-label={`Excluir mapa ${activeMap.data.name}`} onClick={() => void deleteMap(activeMap)}><Trash2 className="size-4" aria-hidden /></Btn></div>
          </div>
          {activeMap.data.description && <p className="whitespace-pre-wrap text-sm text-ink-muted">{activeMap.data.description}</p>}
          <label className="flex items-center gap-3 text-sm font-semibold text-ink">Zoom do grid <input className="w-full accent-primary" type="range" min={60} max={150} step={10} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Zoom do grid" /><span className="w-12 text-right tabular-nums">{zoom}%</span></label>
          <div className="relative mx-auto w-full overflow-hidden rounded-lg border border-ink/30 bg-[oklch(0.97_0.02_88)]" style={{ aspectRatio: `${activeMap.data.columns} / ${activeMap.data.rows}`, minHeight: 220, maxHeight: 500 }} role="group" aria-label={`Grid do mapa ${activeMap.data.name}`}>
            <div className="absolute inset-0" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "center", backgroundImage: "linear-gradient(to right, oklch(0.26 0.035 60 / 28%) 1px, transparent 1px), linear-gradient(to bottom, oklch(0.26 0.035 60 / 28%) 1px, transparent 1px)", backgroundSize: `${100 / activeMap.data.columns}% ${100 / activeMap.data.rows}%` }} />
            {activePins.map((pin) => <button type="button" key={pin.id} className="absolute z-10 max-w-32 -translate-x-1/2 -translate-y-1/2 truncate rounded-full border border-primary-foreground bg-primary px-2 py-1 text-xs font-bold text-primary-foreground shadow" style={{ left: `${pin.data.x * 100}%`, top: `${pin.data.y * 100}%` }} title={`Editar marcador ${pin.data.label}`} onClick={() => { setPinForm({ id: pin.id, mapId: activeMap.id, label: pin.data.label, x: String(pin.data.x), y: String(pin.data.y), note: pin.data.note ?? "" }); setError(""); }}>{pin.data.label}</button>)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-ink-muted">{activePins.length} marcador(es). Selecione um no grid para editar.</p><Btn type="button" variant="outline" onClick={() => { setPinForm({ mapId: activeMap.id, label: "", x: "0.5", y: "0.5", note: "" }); setError(""); }}><MapPin className="size-4" aria-hidden />Novo marcador</Btn></div>
          {!activePins.length && <Empty>Este mapa ainda não tem marcadores.</Empty>}
          {!!activePins.length && <ul className="divide-y divide-border">{activePins.map((pin) => <li key={pin.id} className="flex items-center justify-between gap-2 py-2"><button type="button" className="tap min-w-0 flex-1 text-left" onClick={() => { setPinForm({ id: pin.id, mapId: activeMap.id, label: pin.data.label, x: String(pin.data.x), y: String(pin.data.y), note: pin.data.note ?? "" }); setError(""); }}><span className="block truncate font-semibold text-ink">{pin.data.label}</span><span className="text-xs text-ink-muted">x {pin.data.x.toFixed(2)} · y {pin.data.y.toFixed(2)}{pin.data.note ? ` · ${pin.data.note}` : ""}</span></button><Btn type="button" variant="ghost" size="icon" aria-label={`Excluir marcador ${pin.data.label}`} onClick={() => void deletePin(pin)}><Trash2 className="size-4" aria-hidden /></Btn></li>)}</ul>}
          {pinForm && <form className="space-y-3 border-t border-border pt-3" onSubmit={(event) => void savePin(event)}>
            <h3 className="font-semibold text-ink">{pinForm.id ? "Editar marcador" : "Novo marcador"}</h3>
            <label className="block text-sm font-semibold text-ink">Rótulo<input className="field-input mt-1" maxLength={120} required value={pinForm.label} onChange={(event) => setPinForm({ ...pinForm, label: event.target.value })} /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-ink">X, de 0 a 1<input className="field-input mt-1" type="number" min={0} max={1} step={0.01} value={pinForm.x} onChange={(event) => setPinForm({ ...pinForm, x: event.target.value })} /></label><label className="text-sm font-semibold text-ink">Y, de 0 a 1<input className="field-input mt-1" type="number" min={0} max={1} step={0.01} value={pinForm.y} onChange={(event) => setPinForm({ ...pinForm, y: event.target.value })} /></label></div>
            <label className="block text-sm font-semibold text-ink">Nota<textarea className="field-input mt-1" rows={2} maxLength={1000} value={pinForm.note} onChange={(event) => setPinForm({ ...pinForm, note: event.target.value })} /></label>
            <div className="flex flex-wrap gap-2"><Btn type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar marcador"}</Btn><Btn type="button" variant="outline" disabled={busy} onClick={() => setPinForm(null)}>Cancelar</Btn></div>
          </form>}
        </>}
      </div>}
      {mapForm && <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={(event) => void saveMap(event)}>
        <h3 className="font-semibold text-ink">{mapForm.id ? "Editar mapa" : "Novo mapa"}</h3>
        <label className="block text-sm font-semibold text-ink">Nome<input className="field-input mt-1" maxLength={120} required value={mapForm.name} onChange={(event) => setMapForm({ ...mapForm, name: event.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-ink">Colunas<input className="field-input mt-1" type="number" min={2} max={40} step={1} value={mapForm.columns} onChange={(event) => setMapForm({ ...mapForm, columns: event.target.value })} /></label><label className="text-sm font-semibold text-ink">Linhas<input className="field-input mt-1" type="number" min={2} max={40} step={1} value={mapForm.rows} onChange={(event) => setMapForm({ ...mapForm, rows: event.target.value })} /></label></div>
        <label className="block text-sm font-semibold text-ink">Descrição<textarea className="field-input mt-1" rows={2} maxLength={2000} value={mapForm.description} onChange={(event) => setMapForm({ ...mapForm, description: event.target.value })} /></label>
        <div className="flex flex-wrap gap-2"><Btn type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar mapa"}</Btn><Btn type="button" variant="outline" disabled={busy} onClick={() => setMapForm(null)}>Cancelar</Btn></div>
      </form>}
    </Panel>
    {error && <p className="parchment border border-destructive p-3 text-sm font-semibold text-destructive" role="alert">{error}</p>}
    {status && <p className="parchment p-3 text-sm font-semibold text-ink" role="status" aria-live="polite">{status} · somente local</p>}
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="size-3.5" aria-hidden />Entidades, mapas e marcadores ficam no armazenamento local deste aparelho.</p>
  </div>;
}
