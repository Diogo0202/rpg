"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { narratorOnlyDetails, publicGeneratedEntry } from "../lib/generated-content";

type MapCell = { x: number; y: number; kind: "room" | "corridor" | "wall" };
type GeneratedMap = { seed: number | string; width: number; height: number; layers: Array<{ id: string; cells?: MapCell[] }> };
type GeneratedEntry = { kind: string; name: string; summary: string; details: Record<string, unknown>; seed: number; system?: { name: string; fields: Record<string, unknown> } | null; ai?: boolean };

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
  const [aiEnabled, setAiEnabled] = useState(false);
  const [brief, setBrief] = useState("");
  const [threat, setThreat] = useState<"baixa" | "média" | "alta" | "chefe">("média");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    if (!apiBase || !canManage) return;
    let active = true;
    authHeaders().then((headers) => fetch(`${apiBase}/api/v1/campaigns/${campaignId}/ai/config`, { headers }))
      .then((response) => response.ok ? response.json() : { enabled: false })
      .then((config: { enabled?: boolean }) => { if (active) setAiEnabled(config.enabled === true); })
      .catch(() => { if (active) setAiEnabled(false); });
    return () => { active = false; };
  }, [campaignId, canManage]);

  /** AI drafts reuse the campaign budget; nothing is stored until "Salvar no mundo". */
  async function generateWithAi() {
    if (brief.trim().length < 3) { setMessage("Descreva em poucas palavras o que você quer gerar."); return; }
    setLoading(true); setMessage(""); setSecret("");
    try {
      if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para acessar a API.");
      const response = await fetch(`${apiBase}/api/v1/campaigns/${campaignId}/ai/drafts`, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ kind, brief: brief.trim(), threat: kind === "enemy" ? threat : null, idempotency_key: crypto.randomUUID() }),
      });
      const payload = await response.json().catch(() => null) as { result?: Record<string, unknown>; detail?: string } | null;
      if (!response.ok || !payload?.result) throw new Error(typeof payload?.detail === "string" ? payload.detail : "A IA não gerou o conteúdo.");
      const { name, description, secret: hidden, questions: _questions, relationships: _relationships, ...details } = payload.result;
      setSecret(typeof hidden === "string" ? hidden : "");
      setEntry({ kind, name: String(name ?? "Sem nome"), summary: String(description ?? ""), details, seed: 0, system: null, ai: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao gerar com IA.");
    } finally { setLoading(false); }
  }

  async function saveGenerated(target:"map"|"entry") {
    if(!canManage)return;
    setLoading(true);setMessage("");
    try {
      const client=createClient();
      const result=target==="map"&&map
        ?await client.from("maps").insert({campaign_id:campaignId,name:mapName.trim()||`Mapa ${map.seed}`,document:map,created_by:viewerId}).select("id").single()
        :entry?await client.from("world_entities").insert({campaign_id:campaignId,kind:entry.kind==="item"?"item":"npc",name:entry.name,created_by:viewerId,body:{description:entry.summary,generated:publicGeneratedEntry(entry),role:entry.kind==="enemy"?"antagonist":"neutral",source:entry.ai?"Rascunho de IA revisado pelo narrador":"Gerador original RPG-Atlas"}}).select("id").single():null;
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
        {canManage && <div className="generation-ai">
          <label htmlFor="generation-brief">Pedido para a IA{aiEnabled ? "" : " (desativada nesta instalação)"}</label>
          <textarea id="generation-brief" rows={3} maxLength={1000} value={brief} disabled={!aiEnabled} onChange={(event) => setBrief(event.target.value)}
            placeholder={kind === "item" ? "Ex.: um objeto que a Segunda Inquisição procura" : kind === "enemy" ? "Ex.: caçador que segue a coterie pelo metrô" : "Ex.: dona de um bar que guarda segredos do Príncipe"} />
          {kind === "enemy" && <label htmlFor="generation-threat">Ameaça<select id="generation-threat" value={threat} disabled={!aiEnabled} onChange={(event) => setThreat(event.target.value as typeof threat)}>
            <option value="baixa">Baixa</option><option value="média">Média</option><option value="alta">Alta</option><option value="chefe">Chefe</option>
          </select></label>}
          <button className="primary" type="button" onClick={() => void generateWithAi()} disabled={loading || !aiEnabled}>{loading ? "Gerando…" : "Gerar com IA"}</button>
        </div>}
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
          <div className="panel-title"><h3>Conteúdo da cena</h3>{entry && <small>{entry.ai ? "Rascunho de IA" : `Seed ${entry.seed}`}</small>}</div>
          {entry?.ai && secret && <p className="generation-secret"><strong>Segredo (só para você):</strong> {secret} Ele não é salvo no mundo, porque os jogadores leem a biblioteca.</p>}
          {entry && !entry.ai && Object.keys(narratorOnlyDetails(entry.details)).length > 0 && <div className="generation-secret"><strong>Só para você (não é salvo no mundo, porque os jogadores leem a biblioteca):</strong><dl className="generated-details">{Object.entries(narratorOnlyDetails(entry.details)).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl></div>}
          {entry ? (
            <><h2 className="generated-name">{entry.name}</h2><p>{entry.summary}</p><dl className="generated-details">{Object.entries(publicGeneratedEntry(entry).details).filter(([key, value]) => typeof value === "string" || typeof value === "number").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl><button className="primary" type="button" disabled={loading||!canManage} onClick={()=>void saveGenerated("entry")}>Salvar no mundo</button></>
          ) : <p className="generator-empty">O resultado aparece aqui e pode ser repetido pela seed.</p>}
        </article>
      </div>
    </section>
  );
}
