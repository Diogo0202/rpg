"use client";

import { useMemo, useState } from "react";

import { createEmptyDocument } from "../../lib/map-document";
import { MapEditor, type EditableMap, type MapEditorData } from "./map-editor";
import type { EntityOption, SheetOption } from "./pin-creator";

/**
 * Development-only harness: the real editor with in-memory data, so drawing,
 * pins and the player preview can be checked in a browser without Supabase.
 * Served only by app/dev/map-editor, which returns 404 outside `next dev`.
 */
const CAMPAIGN = "00000000-0000-4000-8000-0000000000c1";
const MASTER = "00000000-0000-4000-8000-0000000000a1";

function portrait(initialsText: string, background: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${background}"/><circle cx="32" cy="24" r="12" fill="${accent}"/><path d="M10 64c0-14 10-22 22-22s22 8 22 22z" fill="${accent}"/><text x="32" y="60" font-family="sans-serif" font-size="10" font-weight="700" text-anchor="middle" fill="#fff">${initialsText}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const SHEETS: SheetOption[] = [
  { id: "00000000-0000-4000-8000-000000000051", name: "Lia Vale", portrait_path: `${CAMPAIGN}/${MASTER}/00000000-0000-4000-8000-0000000000f1.webp` },
  { id: "00000000-0000-4000-8000-000000000052", name: "Bram Ferro", portrait_path: `${CAMPAIGN}/${MASTER}/00000000-0000-4000-8000-0000000000f2.webp` },
  { id: "00000000-0000-4000-8000-000000000053", name: "Sem Retrato", portrait_path: null },
];
const PORTRAITS: Record<string, string> = {
  [SHEETS[0].portrait_path as string]: portrait("LV", "#3a2f4a", "#c9a24a"),
  [SHEETS[1].portrait_path as string]: portrait("BF", "#2f4a3a", "#b55b32"),
};

function makeMap(systemKey: string, id: string, name: string): EditableMap {
  return {
    id, campaign_id: CAMPAIGN, name, version: 1, system_key: systemKey, shared_with_players: false,
    updated_at: new Date().toISOString(), document: createEmptyDocument(systemKey) as unknown as Record<string, unknown>,
  };
}

export function MapEditorFixture() {
  const [maps, setMaps] = useState<EditableMap[]>(() => [
    makeMap("one-ring", "00000000-0000-4000-8000-0000000000e1", "Teste medieval"),
    makeMap("vampire-v5", "00000000-0000-4000-8000-0000000000e2", "Teste cidade moderna"),
  ]);
  const [selectedId, setSelectedId] = useState(maps[0].id);
  const [entities, setEntities] = useState<EntityOption[]>([{ id: "00000000-0000-4000-8000-000000000061", name: "Taverneiro Holmo", kind: "npc" }]);
  const [log, setLog] = useState<string[]>([]);

  const data = useMemo<MapEditorData>(() => ({
    portraitUrls: PORTRAITS,
    async loadReferences() { return { sheets: SHEETS, entities }; },
    async createEntity(_campaign, _viewer, kind, name) {
      const entity: EntityOption = { id: crypto.randomUUID(), kind, name };
      setEntities((items) => [...items, entity]);
      setLog((items) => [`Entidade criada: ${kind} ${name}`, ...items]);
      return entity;
    },
    async saveMap(map, patch) {
      const current = maps.find((item) => item.id === map.id);
      if (!current || current.version !== map.version) return null;
      const saved: EditableMap = { ...current, ...patch, document: patch.document as unknown as Record<string, unknown>, version: current.version + 1, updated_at: new Date().toISOString() };
      setMaps((items) => items.map((item) => item.id === saved.id ? saved : item));
      setLog((items) => [`Salvo v${saved.version}: ${patch.document.structures.length} estruturas, ${patch.document.pins.length} pins`, ...items]);
      return saved;
    },
  }), [maps, entities]);

  const selected = maps.find((item) => item.id === selectedId) ?? maps[0];
  return <main style={{ padding: "1rem", display: "grid", gap: "1rem", background: "#141417", minHeight: "100vh", color: "#f2eee8" }}>
    <header style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "end" }}>
      <div><p style={{ margin: 0, color: "#d4b17d", fontSize: ".75rem", letterSpacing: ".1em" }}>SÓ DESENVOLVIMENTO · DADOS FALSOS</p><h1 style={{ margin: 0 }}>Editor de mapas</h1></div>
      <label style={{ display: "grid", gap: ".3rem" }}>Mapa
        <select data-testid="fixture-map" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
          {maps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </header>
    <MapEditor key={selected.id} campaignId={CAMPAIGN} viewerId={MASTER} map={selected} data={data}
      onSaved={() => undefined} onDelete={() => setLog((items) => ["Excluir ignorado no ambiente de teste", ...items])} />
    <pre data-testid="fixture-saved" style={{ maxHeight: "12rem", overflow: "auto", margin: 0, fontSize: ".75rem" }}>{JSON.stringify(selected.document, null, 1)}</pre>
    <ul data-testid="fixture-log" style={{ margin: 0 }}>{log.map((item, index) => <li key={index}>{item}</li>)}</ul>
  </main>;
}
