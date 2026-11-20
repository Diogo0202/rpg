"use client";

import { editRoomVertex, findRoom } from "../../lib/map-editing";
import { kitForSystem } from "../../lib/map-kits";
import { MAX_FOG_REGIONS, type MapDocumentV2, type MapPin, type MapStructure } from "../../lib/map-document";
import { EMPTY_FOG, regionTargets, structureTitle, SYSTEMS } from "./editor-model";
import type { MapEditorState } from "./use-map-editor";
import styles from "./map-editor.module.css";

type Props = { editor: MapEditorState; document: MapDocumentV2 };

const LAYER_LABELS = [["areas", "Pisos e casas"], ["shadows", "Sombras"], ["walls", "Muros e portas"], ["props", "Objetos"], ["pins", "Pins"], ["grid", "Grade"], ["fog", "Regiões de névoa"]] as const;

export function MapSettingsCard({ editor, document, onDelete }: Props & { onDelete: () => void }) {
  const { kit, commit, map, view, players } = editor;
  return <section className={styles.card} aria-label="Mapa">
    <label>Nome do mapa<input value={map.name} maxLength={160} onChange={(event) => map.setName(event.target.value)} /></label>
    <label>Sistema e tema
      <select value={document.system_key ?? "vampire-v5"} onChange={(event) => commit({ ...document, system_key: event.target.value, background: kitForSystem(event.target.value).background })}>
        {SYSTEMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    <label>Chão de fundo
      <select value={document.background} onChange={(event) => commit({ ...document, background: event.target.value })}>
        {kit.floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.label}</option>)}
      </select>
    </label>
    <label className={styles.check}><input type="checkbox" checked={document.grid.visible} onChange={(event) => commit({ ...document, grid: { ...document.grid, visible: event.target.checked } })} />Grade visível</label>
    <label className={styles.check}><input type="checkbox" checked={view.snapGrid} onChange={(event) => view.setSnapGrid(event.target.checked)} />Ímã na grade</label>
    <label className={styles.check}><input type="checkbox" checked={map.shared} onChange={(event) => map.setShared(event.target.checked)} />Compartilhar com os jogadores</label>
    <label className={styles.check}><input type="checkbox" checked={view.previewPlayers} onChange={(event) => { view.setPreviewPlayers(event.target.checked); editor.selection.setSelectedId(null); }} />Ver como jogador</label>
    {view.previewPlayers && <label>Prévia de
      <select value={view.previewViewer} onChange={(event) => view.setPreviewViewer(event.target.value)}>
        <option value="all">Jogador sem regiões próprias</option>
        {players.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>}
    <div className={styles.row}>
      <button type="button" className={`${styles.tool} ${styles.primary}`} disabled={map.saving} onClick={() => void map.save()}>{map.saving ? "Salvando…" : "Salvar mapa"}</button>
      <button type="button" className={`${styles.tool} ${styles.danger}`} disabled={map.saving} onClick={onDelete}>Excluir</button>
    </div>
    <div className={styles.row}>
      <button type="button" className={styles.tool} disabled={map.exporting} onClick={() => void map.exportPng()} title="Imagem do mapa como está desenhado agora (com a prévia de jogador, se ativa)">Exportar PNG</button>
      <button type="button" className={styles.tool} disabled={map.exporting} onClick={() => void map.exportVtt()} title="Arquivo .dd2vtt com imagem, muros (linha de visão) e portas">Exportar Universal VTT</button>
    </div>
  </section>;
}

export function FogCard({ editor, document }: Props) {
  const { fog: controls, players } = editor;
  const fog = document.fog ?? EMPTY_FOG;
  const targetRegions = fog.regions.filter((region) => regionTargets(region, controls.target)).length;
  return <section className={styles.card} aria-label="Névoa">
    <h4>Névoa e visão</h4>
    <label className={styles.check}><input type="checkbox" checked={fog.enabled} onChange={(event) => controls.update({ enabled: event.target.checked })} />Névoa ativa (o que não foi revelado some para o jogador)</label>
    <label className={styles.check}><input type="checkbox" checked={fog.line_of_sight} onChange={(event) => controls.update({ line_of_sight: event.target.checked })} />Linha de visão a partir do pin do personagem</label>
    <div className={styles.row}>
      <button type="button" className={styles.tool} aria-pressed={controls.mode === "reveal"} onClick={() => controls.setMode("reveal")}>Revelar</button>
      <button type="button" className={styles.tool} aria-pressed={controls.mode === "hide"} onClick={() => controls.setMode("hide")}>Ocultar</button>
    </div>
    <label>Para quem
      <select value={controls.target} onChange={(event) => controls.setTarget(event.target.value)}>
        <option value="all">Todos os jogadores</option>
        {players.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
    </label>
    <div className={styles.row}>
      <button type="button" className={styles.tool} onClick={() => controls.fillTarget("reveal")}>Revelar tudo</button>
      <button type="button" className={styles.tool} onClick={() => controls.fillTarget("hide")}>Cobrir tudo</button>
      <button type="button" className={`${styles.tool} ${styles.danger}`} disabled={targetRegions === 0} onClick={controls.clearTarget}>Limpar ({targetRegions})</button>
    </div>
    <p className={styles.hint}>A região mais recente vence. Muros e portas fechadas bloqueiam a visão; portas abertas deixam ver. {fog.regions.length}/{MAX_FOG_REGIONS} regiões.</p>
  </section>;
}

/** Opções da ferramenta ativa de desenho (muro, casa, porta, sombra e objeto). */
export function ToolOptionsCard({ editor }: { editor: MapEditorState }) {
  const { tool, kit, options } = editor;
  if (tool === "wall" || tool === "house") return <section className={styles.card} aria-label="Muros">
    <h4>{tool === "house" ? "Casa" : "Muro"}</h4>
    {tool === "house" && <div className={styles.row}>
      <button type="button" className={styles.tool} aria-pressed={editor.houseShape === "rect"} onClick={() => { editor.setHouseShape("rect"); editor.setDraftPoints([]); }}>Retângulo</button>
      <button type="button" className={styles.tool} aria-pressed={editor.houseShape === "polygon"} onClick={() => editor.setHouseShape("polygon")}>Polígono</button>
    </div>}
    <label>Material do muro<select value={options.wallMaterial} onChange={(event) => { options.setWallMaterial(event.target.value); options.setWallThickness(kit.walls.find((item) => item.id === event.target.value)?.thickness ?? 60); }}>{kit.walls.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>Espessura ({options.wallThickness})<input type="range" min={10} max={200} value={options.wallThickness} onChange={(event) => options.setWallThickness(Number(event.target.value))} /></label>
    {tool === "house" && <label>Piso<select value={options.floorMaterial} onChange={(event) => options.setFloorMaterial(event.target.value)}>{kit.floors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
  </section>;

  if (tool === "door") return <section className={styles.card} aria-label="Portas">
    <h4>Porta</h4>
    <label>Estilo<select value={options.doorStyle} onChange={(event) => options.setDoorStyle(event.target.value)}>{kit.doors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
  </section>;

  if (tool === "shadow") return <section className={styles.card} aria-label="Sombras">
    <h4>Sombra</h4>
    <label>Escuridão ({Math.round(options.shadowOpacity * 100)}%)<input type="range" min={10} max={100} value={Math.round(options.shadowOpacity * 100)} onChange={(event) => options.setShadowOpacity(Number(event.target.value) / 100)} /></label>
    <label className={styles.check}><input type="checkbox" checked={options.shadowGmOnly} onChange={(event) => options.setShadowGmOnly(event.target.checked)} />Só o Mestre vê</label>
  </section>;

  if (tool === "prop") return <section className={styles.card} aria-label="Objetos">
    <h4>Objetos · {kit.label}</h4>
    <div className={styles.palette}>{kit.props.map((item) => <button key={item.id} type="button" className={styles.paletteItem} aria-pressed={options.propKind === item.id} onClick={() => options.setPropKind(item.id)}>
      <svg viewBox="-55 -55 110 110" aria-hidden="true">{item.shapes.map((shape, index) => shape.shape === "rect" ? <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.r} fill={shape.fill} stroke={shape.stroke} />
        : shape.shape === "circle" ? <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} stroke={shape.stroke} /> : <line key={index} x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2} stroke={shape.stroke} strokeWidth={shape.width} />)}</svg>
      {item.label}</button>)}</div>
  </section>;

  return null;
}

function RoomCorners({ editor, document, selected }: Props & { selected: MapStructure }) {
  const room = findRoom(document, selected.id);
  if (!room) return null;
  const area = document.structures.find((item) => item.id === room.areaId);
  if (area?.type !== "area") return null;
  const index = Math.min(editor.selection.roomVertex, area.points.length - 1);
  const vertex = area.points[index];
  const move = (x: number, y: number, max: number, value: number) => {
    if (Number.isFinite(value) && value >= 0 && value <= max) editor.commit(editRoomVertex(document, room, index, [x, y]));
  };
  return <>
    <label>Canto da sala<select value={index} onChange={(event) => editor.selection.setRoomVertex(Number(event.target.value))}>{area.points.map((_, i) => <option key={i} value={i}>Canto {i + 1}</option>)}</select></label>
    <label>Posição X<input type="number" min="0" max="10000" value={vertex[0]} onChange={(event) => { const next = Number(event.target.value); move(next, vertex[1], 10000, next); }} /></label>
    <label>Posição Y<input type="number" min="0" max={document.height} value={vertex[1]} onChange={(event) => { const next = Number(event.target.value); move(vertex[0], next, document.height, next); }} /></label>
    <p className={styles.hint}>Os {room.doorIds.length} vãos permanecem ligados ao muro da sala.</p>
  </>;
}

export function SelectedStructureCard({ editor, document, selected }: Props & { selected: MapStructure }) {
  const { kit, selection } = editor;
  const { updateSelected, selectedIds } = selection;
  return <section className={styles.card} aria-label="Elemento selecionado">
    <h4>{structureTitle(selected, kit)}</h4>
    {selected.type === "wall" && <>
      <label>Material<select value={selected.material} onChange={(event) => updateSelected({ material: event.target.value })}>{kit.walls.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Espessura ({selected.thickness})<input type="range" min={10} max={200} value={selected.thickness} onChange={(event) => updateSelected({ thickness: Number(event.target.value) })} /></label>
    </>}
    {selected.type === "area" && <>
      <label>Piso<select value={selected.material} onChange={(event) => updateSelected({ material: event.target.value })}>{kit.floors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Rótulo<input value={selected.label ?? ""} maxLength={120} onChange={(event) => updateSelected({ label: event.target.value || undefined })} placeholder="Ex.: Taverna" /></label>
    </>}
    <RoomCorners editor={editor} document={document} selected={selected} />
    {selected.type === "door" && <>
      <label>Estilo<select value={selected.style} onChange={(event) => updateSelected({ style: event.target.value })}>{kit.doors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Estado<select value={selected.state} onChange={(event) => updateSelected({ state: event.target.value as "open" | "closed" | "locked" })}><option value="closed">Fechada</option><option value="open">Aberta</option><option value="locked">Trancada</option></select></label>
      <label>Largura ({selected.width})<input type="range" min={100} max={1200} step={20} value={selected.width} onChange={(event) => updateSelected({ width: Number(event.target.value) })} /></label>
    </>}
    {selected.type === "shadow" && <label>Escuridão ({Math.round(selected.opacity * 100)}%)<input type="range" min={10} max={100} value={Math.round(selected.opacity * 100)} onChange={(event) => updateSelected({ opacity: Number(event.target.value) / 100 })} /></label>}
    {selected.type === "prop" && <>
      <label>Rotação ({selected.rotation}°)<input type="range" min={0} max={345} step={15} value={selected.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) })} /></label>
      <label>Tamanho ({Math.round(selected.scale * 100)}%)<input type="range" min={25} max={400} step={5} value={Math.round(selected.scale * 100)} onChange={(event) => updateSelected({ scale: Number(event.target.value) / 100 })} /></label>
    </>}
    <label className={styles.check}><input type="checkbox" checked={selected.gm_only === true} onChange={(event) => updateSelected({ gm_only: event.target.checked || undefined })} />Só o Mestre vê</label>
    <button type="button" className={`${styles.tool} ${styles.danger}`} onClick={() => selection.removeSelected(selected.id)}>Remover</button>
    {selectedIds.length > 0 && <>
      <p className={styles.hint}>{selectedIds.length} elemento(s) na seleção. Shift + toque/clique adiciona itens.</p>
      <div className={styles.row}><button type="button" className={styles.tool} onClick={() => selection.moveSelectionBy(250, 0)}>Mover →</button><button type="button" className={styles.tool} onClick={selection.duplicateRooms}>Duplicar conjunto</button></div>
      <label>Largura do corredor ({selection.corridorWidth})<input type="range" min={100} max={1500} step={50} value={selection.corridorWidth} onChange={(event) => selection.setCorridorWidth(Number(event.target.value))} /></label>
      <button type="button" className={styles.tool} disabled={selectedIds.length < 2} onClick={selection.makeCorridor}>Ligar duas salas por corredor</button>
    </>}
  </section>;
}

export function SelectedPinCard({ editor, pin }: { editor: MapEditorState; pin: MapPin }) {
  return <section className={styles.card} aria-label="Pin selecionado">
    <h4>{pin.label}</h4>
    <p className={styles.hint}>{pin.kind === "character" ? "Personagem (foto da ficha)" : pin.kind === "npc" ? "NPC" : "Item"}{pin.gm_only ? " · só o Mestre vê" : ""}</p>
    <div className={styles.row}>
      <button type="button" className={styles.tool} onClick={() => editor.pins.setPinDraft({ pin, isNew: false })}>Editar pin</button>
      <button type="button" className={`${styles.tool} ${styles.danger}`} onClick={() => editor.selection.removeSelected(pin.id)}>Remover</button>
    </div>
  </section>;
}

export function LayersCard({ editor, document }: Props) {
  const { layers, setLayers } = editor.view;
  return <section className={styles.card} aria-label="Camadas">
    <h4>Camadas</h4>
    {LAYER_LABELS.map(([key, label]) =>
      <label key={key} className={styles.check}><input type="checkbox" checked={layers[key]} onChange={(event) => setLayers({ ...layers, [key]: event.target.checked })} />{label}</label>)}
    <p className={styles.hint}>{document.structures.length} estruturas · {document.pins.length} pins</p>
  </section>;
}
