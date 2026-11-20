"use client";

import { MapCanvas } from "./map-canvas";
import { EMPTY_FOG, TOOLS } from "./editor-model";
import { supabaseMapData, type EditableMap, type MapEditorData } from "./map-editor-data";
import { PinCreator } from "./pin-creator";
import { FogCard, LayersCard, MapSettingsCard, SelectedPinCard, SelectedStructureCard, ToolOptionsCard } from "./side-panels";
import { useMapEditor } from "./use-map-editor";
import styles from "./map-editor.module.css";

export { supabaseMapData, type EditableMap, type MapEditorData } from "./map-editor-data";

type Props = {
  campaignId: string;
  viewerId: string;
  map: EditableMap;
  onSaved: (map: EditableMap) => void;
  onDelete: () => void;
  data?: MapEditorData;
};

/** Master-only top-down editor. Players see the redacted copy via get_player_map. */
export function MapEditor({ campaignId, viewerId, map, onSaved, onDelete, data = supabaseMapData }: Props) {
  const editor = useMapEditor({ campaignId, viewerId, map, onSaved, data });
  const { document, kit, history, tool, selection, view, pins } = editor;

  if (!document) return <p className={styles.error} role="alert">{editor.initialError || "Este mapa não pode ser aberto no editor."}</p>;

  const selected = selection.selectedId ? document.structures.find((item) => item.id === selection.selectedId) ?? null : null;
  const selectedPin = selection.selectedId ? document.pins.find((pin) => pin.id === selection.selectedId) ?? null : null;
  const fog = document.fog ?? EMPTY_FOG;
  const placedSheetIds = new Set(document.pins.flatMap((pin) => pin.sheet_id ? [pin.sheet_id] : []));
  const panelProps = { editor, document };

  return <div className={styles.editor}>
    <div className={styles.stageColumn}>
      <div className={styles.toolbar} role="toolbar" aria-label="Ferramentas do mapa">
        <div className={styles.toolGroup}>{TOOLS.map((item) => <button key={item.id} type="button" className={styles.tool} aria-pressed={tool === item.id} disabled={view.previewPlayers} title={item.hint} onClick={() => editor.changeTool(item.id)}>{item.label}</button>)}</div>
        <div className={styles.toolGroup}>
          <button type="button" className={styles.tool} disabled={history.past.length === 0} onClick={editor.undo} title="Ctrl+Z">Desfazer</button>
          <button type="button" className={styles.tool} disabled={history.future.length === 0} onClick={editor.redo} title="Ctrl+Y">Refazer</button>
          {editor.draftPoints.length > 0 && <button type="button" className={styles.tool} onClick={editor.finishPolyline}>Concluir traço</button>}
          <button type="button" className={styles.tool} aria-pressed={selection.multiSelectMode} onClick={selection.toggleMultiSelect} title="Ative e toque nos elementos para formar um conjunto">Seleção múltipla</button>
        </div>
      </div>
      <p className={styles.hint}>{view.previewPlayers ? "Prévia do que os jogadores veem: pins e sombras só do Mestre ficam ocultos, e a névoa e a linha de visão valem para o jogador escolhido." : TOOLS.find((item) => item.id === tool)?.hint ?? ""}</p>
      <div className={styles.stage} ref={editor.stageRef}>
        <MapCanvas document={view.preview?.shown ?? document} kit={kit} portraitUrls={pins.portraitUrls} portraitPaths={pins.portraitPaths} mode={view.previewPlayers ? "player" : "editor"}
          selectedId={view.previewPlayers ? null : selection.selectedId} draft={editor.draft} layers={view.layers} label={`Mapa ${editor.map.name}, visto de cima`}
          onPointer={editor.onPointer} panMode={tool === "pan"} vision={view.preview?.vision ?? null}
          fogOutlines={!view.previewPlayers && (tool === "fog" || fog.enabled) ? fog.regions : null} />
      </div>
      <p className={styles.status} role="status" aria-live="polite">{editor.message || (history.dirty ? "Alterações ainda não salvas." : "")}</p>
    </div>

    <aside className={styles.side}>
      <MapSettingsCard {...panelProps} onDelete={onDelete} />
      {!pins.pinDraft && tool === "fog" && <FogCard {...panelProps} />}
      {pins.pinDraft && <PinCreator key={pins.pinDraft.pin.id} kit={kit} pin={pins.pinDraft.pin} isNew={pins.pinDraft.isNew} sheets={pins.sheets} entities={pins.entities}
        portraitUrls={pins.portraitUrls} placedSheetIds={placedSheetIds} onSubmit={pins.submitPin} onCancel={() => pins.setPinDraft(null)} onCreateEntity={pins.createEntity} />}
      {!pins.pinDraft && <ToolOptionsCard editor={editor} />}
      {!pins.pinDraft && selected && <SelectedStructureCard {...panelProps} selected={selected} />}
      {!pins.pinDraft && selectedPin && <SelectedPinCard editor={editor} pin={selectedPin} />}
      <LayersCard {...panelProps} />
    </aside>
  </div>;
}
