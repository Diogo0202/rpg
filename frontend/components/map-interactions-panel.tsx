"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapDocumentV2 } from "../lib/map-document";
import {
  examinedItems, MAP_ACTION_LABELS, MAP_OBJECT_LABELS, mapActionsFrom, mapObjectActions, mapObjectFootprint,
  mapObjectsFrom, validateMapObjectConfig, type MapAction, type MapObject, type MapObjectConfig, type MapObjectKind, type MapRpc,
} from "../lib/map-interactions";
import styles from "./map-interactions-panel.module.css";

type Props = {
  mapId: string; campaignId: string; viewerId: string; canManage: boolean; document: MapDocumentV2;
  rpc: MapRpc; sheets: Array<{ id: string; name: string }>; onChanged?: () => void;
};
type TargetMap = { id: string; name: string; width?: number; height?: number; grid_size?: number };
const emptyConfig = (): MapObjectConfig => ({ kind: "container", label: "", reach_cells: 1, items: [] });
const STATUS: Record<string, string> = { pending: "Aguardando narrador", approved: "Aprovado", rejected: "Recusado", stale: "Estado alterado", cancelled: "Cancelado" };

/** Shared on web and mobile. Authorization, reach and every effect are decided by the server. */
export function MapInteractionsPanel({ mapId, campaignId, viewerId, canManage, document, rpc, sheets, onChanged }: Props) {
  const scope = `${campaignId}/${viewerId}/${mapId}/${canManage}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [snapshot, setSnapshot] = useState<{ scope: string; objects: MapObject[]; actions: MapAction[] }>({ scope: "", objects: [], actions: [] });
  const [targets, setTargets] = useState<TargetMap[]>([]);
  const [objectId, setObjectId] = useState("");
  const [sheetId, setSheetId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [elementId, setElementId] = useState("");
  const [config, setConfig] = useState<MapObjectConfig>(emptyConfig);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const operations = useRef(new Map<string, string>());
  const objects = snapshot.scope === scope ? snapshot.objects : [];
  const actions = snapshot.scope === scope ? snapshot.actions : [];
  const selected = objects.find((object) => object.id === objectId);
  const actualSheet = sheets.find((sheet) => sheet.id === sheetId)?.id ?? sheets[0]?.id ?? "";
  const contents = selected ? examinedItems(actions, selected.id, actualSheet) : [];

  const load = useCallback(async () => {
    const [objectResult, actionResult] = await Promise.all([
      rpc("get_map_objects", { p_map_id: mapId }), rpc("list_map_actions", { p_map_id: mapId }),
    ]);
    if (scopeRef.current !== scope) return;
    if (objectResult.error || actionResult.error) {
      setSnapshot({ scope, objects: [], actions: [] });
      throw new Error(objectResult.error?.message ?? actionResult.error?.message ?? "Não foi possível ler as interações.");
    }
    setSnapshot({ scope, objects: mapObjectsFrom(objectResult.data), actions: mapActionsFrom(actionResult.data) });
  }, [rpc, mapId, scope]);

  useEffect(() => {
    setMessage(""); setObjectId(""); setSheetId(""); setItemId(""); setElementId(""); setConfig(emptyConfig()); setTargets([]);
    void load().catch((error) => { if (scopeRef.current === scope) setMessage(error.message); });
    const timer = setInterval(() => {
      if (globalThis.document?.visibilityState === "hidden") return;
      void load().catch((error) => { if (scopeRef.current === scope) setMessage(error.message); });
    }, 5000);
    if (canManage) void rpc("list_map_interaction_targets", { p_map_id: mapId }).then((result) => {
      if (scopeRef.current === scope && !result.error && Array.isArray(result.data)) setTargets(result.data);
    });
    return () => clearInterval(timer);
  }, [scope, mapId, canManage, load, rpc]);

  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    const capturedScope = scope;
    busyRef.current = true; setBusy(true); setMessage("");
    try { await task(); } catch (error) {
      if (scopeRef.current === capturedScope) setMessage(error instanceof Error ? error.message : "A ação falhou.");
    } finally { busyRef.current = false; if (scopeRef.current === capturedScope) setBusy(false); }
  }

  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc(name, args);
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }

  function edit(object?: MapObject) {
    setElementId(object?.element_id ?? "");
    setConfig(object ? { kind: object.kind, label: object.label, reach_cells: object.reach_cells,
      clue_text: object.clue_text, items: object.items ?? [], target_map_id: object.target_map_id, target_x: object.target_x, target_y: object.target_y } : emptyConfig());
  }

  async function saveObject() {
    const footprint = mapObjectFootprint(document, elementId);
    const element = document.structures.find((item) => item.id === elementId);
    if (!footprint || !element) throw new Error("Escolha uma porta ou um objeto do mapa salvo.");
    if ((config.kind === "door") !== (element.type === "door")) throw new Error("Configure portas como Porta; os demais tipos precisam de um objeto decorativo.");
    const clean = { ...config, label: config.label.trim(), interaction_radius: element.type === "prop" ? footprint.radius : 0 };
    const problem = validateMapObjectConfig(clean);
    if (problem) throw new Error(problem);
    await call("save_map_object", { p_map_id: mapId, p_element_id: elementId, p_config: clean });
    await load(); setMessage("Interação salva. Toda ação aguarda aprovação do narrador.");
  }

  async function request(action: string) {
    if (!selected || !actualSheet) throw new Error("Escolha o objeto e uma ficha própria com marcador neste mapa.");
    if (action === "take" && (!contents.some((item) => item.id === itemId) || !Number.isSafeInteger(quantity) || quantity < 1)) throw new Error("Escolha um item revelado por exame aprovado e uma quantidade inteira positiva.");
    const key = JSON.stringify([mapId, selected.id, actualSheet, action, action === "take" ? itemId : null, action === "take" ? quantity : 1]);
    const operation = operations.current.get(key) ?? crypto.randomUUID();
    operations.current.set(key, operation);
    const result = await call("request_map_action", { p_map_id: mapId, p_object_id: selected.id, p_sheet_id: actualSheet,
      p_action: action, p_operation_id: operation, p_item_id: action === "take" ? itemId : null, p_quantity: action === "take" ? quantity : 1 });
    operations.current.delete(key);
    if (result && typeof result === "object" && "queued" in result && result.queued) {
      setMessage("Pedido na fila deste aparelho. O narrador só o recebe após a conexão voltar."); return;
    }
    await load(); setMessage("Pedido recebido. Aguarde a decisão do narrador.");
  }

  async function decide(id: string, approve: boolean) {
    await call("decide_map_action", { p_request_id: id, p_approve: approve, p_note: "" });
    await load(); onChanged?.(); setMessage(approve ? "Ação aprovada e aplicada. Atualize o mapa para conferir o estado." : "Pedido recusado.");
  }

  const target = targets.find((item) => item.id === config.target_map_id);
  const cellSize = target?.grid_size ?? 250;
  return <section className={styles.panel} aria-label="Interações do mapa" aria-busy={busy}>
    <div className={styles.header}><div><h3>Objetos e pedidos</h3><p>Toda ação depende do narrador. Alcance e obstáculos são conferidos ao pedir e ao aprovar.</p></div>
      <button type="button" disabled={busy} onClick={() => void run(load)}>Atualizar pedidos</button></div>
    {message && <p role="status" className={styles.message}>{message}</p>}
    {canManage ? <>
      <div className={styles.grid}>
        <label>Interação configurada<select value={objectId} onChange={(event) => { setObjectId(event.target.value); edit(objects.find((item) => item.id === event.target.value)); }}>
          <option value="">Nova interação</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.label}</option>)}</select></label>
        <label>Elemento do mapa salvo<select value={elementId} onChange={(event) => {
          setElementId(event.target.value);
          const element = document.structures.find((item) => item.id === event.target.value);
          setConfig((current) => ({ ...current, kind: element?.type === "door" ? "door" : current.kind === "door" ? "container" : current.kind }));
        }}><option value="">Escolher elemento</option>{document.structures.filter((item) => item.type === "door" || item.type === "prop").map((item, index) =>
          <option key={item.id} value={item.id}>{item.type === "door" ? "Porta" : item.type === "prop" ? item.kind : "Objeto"} {index + 1}{item.gm_only ? " (oculto)" : ""}</option>)}</select></label>
        <label>Nome do objeto<input value={config.label} maxLength={120} onChange={(event) => setConfig({ ...config, label: event.target.value })} /></label>
        <label>Tipo de interação<select value={config.kind} onChange={(event) => setConfig({ ...config, kind: event.target.value as MapObjectKind })}>
          {Object.entries(MAP_OBJECT_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
        <label>Alcance em células (diagonais incluídas)<input type="number" min={0} max={20} step={0.5} value={config.reach_cells} onChange={(event) => setConfig({ ...config, reach_cells: Number(event.target.value) })} /></label>
      </div>
      {config.kind === "clue" && <label>Conteúdo da pista (só aparece após aprovação)<textarea value={config.clue_text ?? ""} maxLength={5000} onChange={(event) => setConfig({ ...config, clue_text: event.target.value })} /></label>}
      {config.kind === "container" && <fieldset><legend>Conteúdo do recipiente</legend>{(config.items ?? []).map((item) => <div className={styles.item} key={item.id}>
        <label>Nome do item<input value={item.name} maxLength={160} onChange={(event) => setConfig({ ...config, items: config.items?.map((row) => row.id === item.id ? { ...row, name: event.target.value } : row) })} /></label>
        <label>Quantidade<input type="number" min={0} max={100000} value={item.quantity} onChange={(event) => setConfig({ ...config, items: config.items?.map((row) => row.id === item.id ? { ...row, quantity: Number(event.target.value) } : row) })} /></label>
        <button type="button" onClick={() => setConfig({ ...config, items: config.items?.filter((row) => row.id !== item.id) })}>Remover item</button></div>)}
        <button type="button" disabled={(config.items?.length ?? 0) >= 100} onClick={() => setConfig({ ...config, items: [...(config.items ?? []), { id: crypto.randomUUID(), name: "", quantity: 1, category: "equipment" }] })}>Adicionar item</button></fieldset>}
      {config.kind === "passage" && <div className={styles.grid}>
        <label>Mapa de destino<select value={config.target_map_id ?? ""} onChange={(event) => setConfig({ ...config, target_map_id: event.target.value, target_x: 0, target_y: 0 })}>
          <option value="">Escolher mapa</option>{targets.map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}</select></label>
        <label>Coluna de chegada (células)<input type="number" min={0} step={0.5} value={(config.target_x ?? 0) / cellSize} onChange={(event) => setConfig({ ...config, target_x: Number(event.target.value) * cellSize })} /></label>
        <label>Linha de chegada (células)<input type="number" min={0} step={0.5} value={(config.target_y ?? 0) / cellSize} onChange={(event) => setConfig({ ...config, target_y: Number(event.target.value) * cellSize })} /></label>
      </div>}
      <div className={styles.row}><button type="button" disabled={busy || !elementId} onClick={() => void run(saveObject)}>Salvar interação</button>
        {selected && <button type="button" disabled={busy} onClick={() => void run(async () => {
          await call("delete_map_object", { p_map_id: mapId, p_object_id: selected.id }); await load(); setObjectId(""); edit(); setMessage("Interação removida.");
        })}>Remover interação</button>}</div>
      <p>Salve primeiro as alterações do desenho. Configurar uma interação não salva o mapa em edição.</p>
    </> : <>
      <div className={styles.grid}><label>Personagem<select value={actualSheet} onChange={(event) => { setSheetId(event.target.value); setItemId(""); }}>
        <option value="">Escolher ficha</option>{sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}</select></label>
        <label>Objeto revelado<select value={objectId} onChange={(event) => { setObjectId(event.target.value); setItemId(""); }}>
          <option value="">Escolher objeto</option>{objects.map((object) => <option key={object.id} value={object.id}>{object.label}</option>)}</select></label></div>
      {selected?.kind === "container" && <div className={styles.grid}><label>Item revelado por exame aprovado<select value={itemId} onChange={(event) => setItemId(event.target.value)}>
        <option value="">Escolher item</option>{contents.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.quantity})</option>)}</select></label>
        <label>Quantidade pedida<input type="number" min={1} step={1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label></div>}
      <div className={styles.row}>{selected && mapObjectActions(selected.kind).map((action) => <button type="button" key={action} disabled={busy || !actualSheet || (action === "take" && !itemId)} onClick={() => void run(() => request(action))}>{MAP_ACTION_LABELS[action]}</button>)}</div>
      {!objects.length && <p>Nenhum objeto interativo revelado neste mapa.</p>}
    </>}
    <h4>{canManage ? "Pedidos da campanha neste mapa" : "Seus pedidos neste mapa"}</h4>
    <ul className={styles.requests}>{actions.map((action) => <li key={action.id}>
      <strong>{objects.find((object) => object.id === action.object_id)?.label ?? "Objeto"}</strong>{" · "}{MAP_ACTION_LABELS[action.action] ?? action.action}{" · "}{sheets.find((sheet) => sheet.id === action.sheet_id)?.name ?? "Personagem"}
      <p>{STATUS[action.status] ?? action.status}{action.note ? `: ${action.note}` : ""}</p>
      {action.status === "approved" && typeof action.result?.clue_text === "string" && <p className={styles.clue}>{action.result.clue_text}</p>}
      {action.status === "approved" && action.action === "take" && <p>Entrega confirmada no inventário da ficha.</p>}
      {action.status === "approved" && action.action === "travel" && <p>Passagem confirmada. Atualize a lista para abrir o mapa de chegada.</p>}
      {canManage && action.status === "pending" && <div className={styles.row}><button type="button" disabled={busy} onClick={() => void run(() => decide(action.id, true))}>Aprovar</button><button type="button" disabled={busy} onClick={() => void run(() => decide(action.id, false))}>Recusar</button></div>}
    </li>)}</ul>
    {!actions.length && <p>Nenhum pedido registrado.</p>}
  </section>;
}
