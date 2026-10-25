"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { createClient } from "../lib/supabase/client";
import { downloadText } from "../lib/download";
import { createEmptyDocument, parseMapDocument } from "../lib/map-document";
import { kitForSystem } from "../lib/map-kits";
import { MapCanvas } from "./map-editor/map-canvas";
import { MapEditor, type EditableMap } from "./map-editor/map-editor";
import editorStyles from "./map-editor/map-editor.module.css";
import styles from "./saved-maps-panel.module.css";

const MAP_COLUMNS = "id, campaign_id, name, document, version, system_key, shared_with_players, updated_at";
const SYSTEM_OPTIONS = [
  { id: "one-ring", label: "O Um Anel · medieval" },
  { id: "vampire-v5", label: "Vampiro V5 · cidade moderna" },
  { id: "vampire-v3", label: "Vampiro V3 · cidade moderna" },
  { id: "hunter", label: "Caçador · cidade moderna" },
];

function ReadOnlyMap({ map }: { map: EditableMap }) {
  const parsed = parseMapDocument(map.document, map.system_key);
  if (!parsed.document) return <p className={styles.error} role="alert">{parsed.error}</p>;
  return <div className={styles.readOnly}>
    <p className={styles.intro}>O criador de mapas táticos é exclusivo da versão para computador. Aqui você consulta o mapa; para editar, abra a campanha numa tela maior.</p>
    <div className={editorStyles.stage}>
      <MapCanvas document={parsed.document} kit={kitForSystem(parsed.document.system_key)} portraitUrls={{}} mode="editor" label={`Mapa ${map.name}, visto de cima`} />
    </div>
  </div>;
}

function mapFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "mapa";
}

/** The master's map library: create, open in the top-down editor, export and delete. */
export function SavedMapsPanel({ campaignId, viewerId, canManage }: { campaignId: string; viewerId: string; canManage: boolean }) {
  const uid = useId();
  const campaignRef = useRef(campaignId);
  campaignRef.current = campaignId;
  const [maps, setMaps] = useState<EditableMap[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [newSystem, setNewSystem] = useState("vampire-v5");
  const [revision, setRevision] = useState(0);
  // The tactical map creator is desktop-only; phones get a read-only view.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    if (!canManage) { setMaps([]); setLoading(false); return; }
    const client = createClient();
    void Promise.all([
      client.from("maps").select(MAP_COLUMNS).eq("campaign_id", campaignId).order("updated_at", { ascending: false }),
      client.from("system_templates").select("schema").eq("campaign_id", campaignId).eq("status", "approved"),
    ]).then(([mapResult, templateResult]) => {
      if (!active) return;
      if (mapResult.error) { setMessage("Não foi possível carregar os mapas salvos desta campanha."); setLoading(false); return; }
      const rows = (mapResult.data ?? []) as EditableMap[];
      setMaps(rows);
      setSelectedId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? null);
      const systemKey = (templateResult.data ?? []).map((row) => (row.schema as { system_key?: string } | null)?.system_key)
        .find((key) => SYSTEM_OPTIONS.some((option) => option.id === key));
      if (systemKey) setNewSystem(systemKey);
      setLoading(false);
    });
    return () => { active = false; };
  }, [campaignId, canManage, revision]);

  async function createMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || name.length > 160) { setMessage("Dê ao mapa um nome de até 160 caracteres."); return; }
    setBusy(true);
    const requestCampaign = campaignId;
    try {
      const { data, error } = await createClient().from("maps")
        .insert({ campaign_id: campaignId, name, created_by: viewerId, system_key: newSystem, document: createEmptyDocument(newSystem) })
        .select(MAP_COLUMNS).single();
      if (campaignRef.current !== requestCampaign) return;
      if (error || !data) throw error ?? new Error("insert failed");
      setMaps((items) => [data as EditableMap, ...items]);
      setSelectedId((data as EditableMap).id);
      setNewName("");
      setMessage("Mapa criado. Desenhe muros, casas e coloque pins.");
    } catch {
      if (campaignRef.current === requestCampaign) setMessage("Não foi possível criar o mapa.");
    } finally { setBusy(false); }
  }

  async function deleteMap(map: EditableMap) {
    if (!window.confirm(`Excluir o mapa ${map.name}? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      const { data, error } = await createClient().from("maps").delete().eq("id", map.id).eq("campaign_id", campaignId).eq("version", map.version).select("id").maybeSingle();
      if (error || !data) throw error ?? new Error("stale map");
      setMaps((items) => items.filter((item) => item.id !== map.id));
      setSelectedId(null);
      setMessage("Mapa excluído.");
    } catch {
      setMessage("Não foi possível excluir. O mapa pode ter sido alterado em outra sessão; atualize a lista.");
    } finally { setBusy(false); }
  }

  function exportJson(map: EditableMap) {
    try {
      downloadText(`${mapFilePart(map.name)}.json`, JSON.stringify({ name: map.name, system_key: map.system_key, document: map.document }, null, 2));
      setMessage("JSON do mapa salvo.");
    } catch { setMessage("Não foi possível exportar o JSON do mapa."); }
  }

  const selected = maps.find((item) => item.id === selectedId) ?? null;
  const titleId = `${uid}-title`;
  return <section className={styles.panel} aria-labelledby={titleId} aria-busy={loading || busy}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>CARTOGRAFIA DA CAMPANHA</p><h2 id={titleId}>Mapas</h2>
        <p className={styles.intro}>Mapas vistos de cima: muros, casas, portas, sombras, objetos e pins com as fotos das fichas. O tema segue o sistema: medieval no Um Anel, cidade moderna no Vampiro e no Caçador.</p></div>
      {canManage && <button type="button" className={styles.secondaryButton} disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}>Atualizar</button>}
    </header>
    <p className={styles.message} role="status" aria-live="polite">{message}</p>

    {!canManage ? <p className={styles.empty}>O editor de mapas é do narrador desta campanha.</p> : loading ? <p className={styles.empty}>Carregando mapas…</p> : <>
      <div className={styles.toolbar}>
        {maps.length > 0 && <label className={styles.mapSelectLabel} htmlFor={`${uid}-select`}>Mapa
          <select id={`${uid}-select`} value={selectedId ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
            {maps.map((item) => <option key={item.id} value={item.id}>{item.name}{item.shared_with_players ? " · compartilhado" : ""}</option>)}
          </select></label>}
        {selected && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => exportJson(selected)}>Exportar JSON</button>}
      </div>
      <form className={styles.toolbar} onSubmit={createMap} aria-label="Novo mapa">
        <label htmlFor={`${uid}-new-name`}>Novo mapa<input id={`${uid}-new-name`} value={newName} maxLength={160} placeholder="Ex.: Taverna do Pônei" onChange={(event) => setNewName(event.target.value)} /></label>
        <label htmlFor={`${uid}-new-system`}>Sistema<select id={`${uid}-new-system`} value={newSystem} onChange={(event) => setNewSystem(event.target.value)}>
          {SYSTEM_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select></label>
        <button type="submit" className={styles.primaryButton} disabled={busy || !newName.trim()}>Criar mapa</button>
      </form>
      {selected && narrow ? <ReadOnlyMap map={selected} />
        : selected ? <MapEditor key={selected.id} campaignId={campaignId} viewerId={viewerId} map={selected}
        onSaved={(saved) => setMaps((items) => items.map((item) => item.id === saved.id ? saved : item))}
        onDelete={() => void deleteMap(selected)} />
        : <p className={styles.empty}>Nenhum mapa ainda. Crie um acima ou use o gerador procedural na aba Geração.</p>}
    </>}
  </section>;
}
