"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";

type MapCell = { x: number; y: number; kind: "room" | "corridor" | "wall" };
type GeneratedMap = { seed: number | string; width: number; height: number; layers: Array<{ id: string; cells?: MapCell[] }> };
type GeneratedEntry = { kind: string; name: string; summary: string; details: Record<string, unknown>; seed: number; system?: { name: string; fields: Record<string, unknown> } | null };

const apiBase = process.env.NEXT_PUBLIC_API_URL;

async function authHeaders() {
  const { data } = await createClient().auth.getSession();
  if (!data.session) throw new Error("Entre na campanha para gerar conteúdo.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` };
}

export function GenerationPanel({campaignId,viewerId,canManage}:{campaignId:string;viewerId:string;canManage:boolean}) {
  const [map, setMap] = useState<GeneratedMap | null>(null);
  const [entry, setEntry] = useState<GeneratedEntry | null>(null);
  const [kind, setKind] = useState<"npc" | "enemy" | "item">("npc");
  const [seed, setSeed] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [mapName,setMapName]=useState("");

  async function saveGenerated(target:"map"|"entry") {
    if(!canManage)return;
    setLoading(true);setMessage("");
    try {
      const client=createClient();
      const result=target==="map"&&map
        ?await client.from("maps").insert({campaign_id:campaignId,name:mapName.trim()||`Mapa ${map.seed}`,document:map,created_by:viewerId}).select("id").single()
        :entry?await client.from("world_entities").insert({campaign_id:campaignId,kind:entry.kind==="item"?"item":"npc",name:entry.name,created_by:viewerId,body:{description:entry.summary,generated:entry,role:entry.kind==="enemy"?"antagonist":"neutral",source:"Gerador original RPG-Atlas"}}).select("id").single():null;
      if(!result||result.error||!result.data)throw new Error("Falha ao gravar. Confira suas permissões e as migrations.");
      setMessage(target==="map"?"Mapa salvo. Abra Mapas para editar seus marcadores.":"Conteúdo salvo na biblioteca do mundo.");
    } catch(error){setMessage(error instanceof Error?error.message:"Não foi possível gravar.");}
    finally{setLoading(false);}
  }

  async function generateMap() {
    setLoading(true);
    setMessage("");
    try {
      if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para acessar a API.");
      const parsedSeed = seed.trim() ? Number(seed) : crypto.getRandomValues(new Uint32Array(1))[0];
      if (!Number.isSafeInteger(parsedSeed) || parsedSeed < 0) throw new Error("Use uma seed numérica não negativa.");
      const headers = await authHeaders();
      const response = await fetch(`${apiBase}/api/v1/maps/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ width: 32, height: 24, room_count: 8, seed: parsedSeed }),
      });
      if (!response.ok) throw new Error("A API recusou os parâmetros do mapa.");
      setMap((await response.json()) as GeneratedMap);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao gerar o mapa.");
    } finally {
      setLoading(false);
    }
  }

  async function generateEntry() {
    setLoading(true);
    setMessage("");
    try {
      if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para acessar a API.");
      const payload: { kind: string; seed?: number } = { kind };
      if (seed.trim()) {
        const parsedSeed = Number(seed);
        if (!Number.isSafeInteger(parsedSeed) || parsedSeed < 0) throw new Error("Use uma seed numérica não negativa.");
        payload.seed = parsedSeed;
      }
      const headers = await authHeaders();
      const response = await fetch(`${apiBase}/api/v1/content/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Não foi possível criar esse conteúdo.");
      setEntry((await response.json()) as GeneratedEntry);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao gerar conteúdo.");
    } finally {
      setLoading(false);
    }
  }

  const terrain = map?.layers.find((layer) => layer.id === "terrain")?.cells ?? [];

  return (
    <section className="content generation-layout">
      <article className="generation-card">
        <p className="eyebrow">CONSTRUÇÃO DA CRÔNICA</p>
        <h2>Crie a próxima cena.</h2>
        <label htmlFor="generation-seed">Seed opcional</label>
        <input id="generation-seed" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="Vazio gera um resultado novo" />
        <div className="generation-actions">
          <button className="primary" type="button" onClick={generateMap} disabled={loading}>{loading ? "Gerando…" : "Gerar mapa tático"}</button>
        </div>
        <div className="generation-actions">
          <label className="select-label" htmlFor="content-kind">Conteúdo</label>
          <select id="content-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="npc">Personagem não jogador</option>
            <option value="enemy">Inimigo</option>
            <option value="item">Item</option>
          </select>
          <button className="quiet" type="button" onClick={generateEntry} disabled={loading}>Gerar</button>
        </div>
        {message && <p className="auth-message" role="status">{message}</p>}
      </article>

      <div className="generation-results">
        <article className="generation-card">
          <div className="panel-title"><h3>Prévia do mapa</h3>{map && <small>Seed {map.seed}</small>}</div>
          {map ? (
            <><div className="map-preview" style={{ gridTemplateColumns: `repeat(${map.width}, minmax(0, 1fr))` }} aria-label={`Mapa gerado de ${map.width} por ${map.height} células`}>
              {terrain.map((cell) => <span key={`${cell.x}-${cell.y}`} className={`map-cell ${cell.kind}`} />)}
            </div><label>Nome do mapa<input value={mapName} maxLength={160} onChange={event=>setMapName(event.target.value)}/></label><button className="primary" type="button" disabled={loading||!canManage} onClick={()=>void saveGenerated("map")}>Salvar mapa na campanha</button></>
          ) : <p className="generator-empty">Gere um mapa para ver salas e passagens conectadas.</p>}
        </article>
        <article className="generation-card">
          <div className="panel-title"><h3>Conteúdo da cena</h3>{entry && <small>Seed {entry.seed}</small>}</div>
          {entry ? (
            <><h2 className="generated-name">{entry.name}</h2><p>{entry.summary}</p><dl className="generated-details">{Object.entries(entry.details).filter(([key, value]) => typeof value === "string" || typeof value === "number").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl><button className="primary" type="button" disabled={loading||!canManage} onClick={()=>void saveGenerated("entry")}>Salvar no mundo</button></>
          ) : <p className="generator-empty">O resultado aparece aqui e pode ser repetido pela seed.</p>}
        </article>
      </div>
    </section>
  );
}
