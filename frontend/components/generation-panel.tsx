"use client";

import { useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { combatBlockOf, narratorOnlyDetails, publicGeneratedEntry } from "../lib/generated-content";
import { buildMapGenerationRequest, MAP_GENERATION_LIMITS, roomCapacity } from "../lib/map-generation";

const combatSystems = [["v5", "Vampiro V5"], ["v3", "Vampiro V3"], ["hunter", "Caçador"], ["one_ring", "O Um Anel"], ["sotdl", "Shadow of the Demon Lord"]] as const;
const combatTiers = [["fraco", "Fraco"], ["padrao", "Padrão"], ["perigoso", "Perigoso"], ["chefe", "Chefe"]] as const;
type CombatSystem = typeof combatSystems[number][0];
type CombatTier = typeof combatTiers[number][0];
type ActiveCombat = { id: string; title: string };

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
  const [mapWidth, setMapWidth] = useState("32");
  const [mapHeight, setMapHeight] = useState("24");
  const [mapRooms, setMapRooms] = useState("8");
  const [mapSeed, setMapSeed] = useState("");
  const capacity = roomCapacity(Number(mapWidth) || 0, Number(mapHeight) || 0);
  const [combatSystem, setCombatSystem] = useState<CombatSystem | "">("");
  const [difficulty, setDifficulty] = useState<CombatTier>("padrao");
  const [combats, setCombats] = useState<ActiveCombat[]>([]);
  const [combatId, setCombatId] = useState("");
  const [alsoSaveEntity, setAlsoSaveEntity] = useState(true);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    createClient().from("combat_sessions").select("id,title").eq("campaign_id", campaignId).eq("active", true).order("created_at", { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (!active) return;
        const rows = error ? [] : (data ?? []) as ActiveCombat[];
        setCombats(rows);
        setCombatId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id ?? "");
      });
    return () => { active = false; };
  }, [campaignId, canManage]);

  /** GER-06: a API regenera o conteúdo pela seed e insere o bloco no combate ativo. */
  async function insertIntoCombat() {
    if (!canManage || !entry || entry.ai || entry.kind === "item" || !combatBlockOf(entry.details) || !combatId) return;
    const block = combatBlockOf(entry.details)!;
    setLoading(true); setMessage("");
    try {
      if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para acessar a API.");
      const response = await fetch(`${apiBase}/api/v1/campaigns/${campaignId}/content/apply`, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ kind: entry.kind, seed: entry.seed, combat_system: block.system, difficulty: block.tier, combat_id: combatId, save_entity: alsoSaveEntity, idempotency_key: crypto.randomUUID() }),
      });
      const payload = await response.json().catch(() => null) as { application?: { participant_name?: string }; detail?: unknown } | null;
      if (!response.ok) throw new Error(typeof payload?.detail === "string" ? payload.detail : "Não foi possível inserir no combate.");
      setMessage(`${payload?.application?.participant_name ?? entry.name} entrou no combate${alsoSaveEntity ? " e foi salvo no mundo" : ""}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao inserir no combate.");
    } finally { setLoading(false); }
  }

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
      const built = buildMapGenerationRequest({ width: mapWidth, height: mapHeight, rooms: mapRooms, seed: mapSeed });
      if (!built.request) throw new Error(built.error);
      const headers = await authHeaders();
      const response = await fetch(`${apiBase}/api/v1/maps/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify(built.request),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { detail?: unknown } | null;
        throw new Error(typeof payload?.detail === "string" ? `A API recusou os parâmetros: ${payload.detail}.` : "A API recusou os parâmetros do mapa.");
      }
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
      const payload: { kind: string; seed?: number; combat_system?: CombatSystem; difficulty?: CombatTier } = { kind };
      if (kind !== "item" && combatSystem) { payload.combat_system = combatSystem; payload.difficulty = difficulty; }
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
        <fieldset className="generation-map-options">
          <legend>Mapa tático</legend>
          <label htmlFor="map-width">Largura (células)<input id="map-width" type="number" inputMode="numeric" min={MAP_GENERATION_LIMITS.minDimension} max={MAP_GENERATION_LIMITS.maxDimension} value={mapWidth} onChange={(event) => setMapWidth(event.target.value)} /></label>
          <label htmlFor="map-height">Altura (células)<input id="map-height" type="number" inputMode="numeric" min={MAP_GENERATION_LIMITS.minDimension} max={MAP_GENERATION_LIMITS.maxDimension} value={mapHeight} onChange={(event) => setMapHeight(event.target.value)} /></label>
          <label htmlFor="map-rooms">Salas{capacity > 0 ? ` (até ${Math.min(capacity, MAP_GENERATION_LIMITS.maxRooms)})` : ""}<input id="map-rooms" type="number" inputMode="numeric" min={MAP_GENERATION_LIMITS.minRooms} max={Math.max(1, Math.min(capacity, MAP_GENERATION_LIMITS.maxRooms))} value={mapRooms} onChange={(event) => setMapRooms(event.target.value)} /></label>
          <label htmlFor="map-seed">Seed do mapa<input id="map-seed" value={mapSeed} maxLength={MAP_GENERATION_LIMITS.maxSeedLength} onChange={(event) => setMapSeed(event.target.value)} placeholder="Número ou texto; vazio sorteia" /></label>
        </fieldset>
        <div className="generation-actions">
          <button className="primary" type="button" onClick={generateMap} disabled={loading}>{loading ? "Gerando…" : "Gerar mapa tático"}</button>
        </div>
        <label htmlFor="generation-seed">Seed opcional do conteúdo</label>
        <input id="generation-seed" inputMode="numeric" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="Vazio gera um resultado novo" />
        <div className="generation-actions">
          <label className="select-label" htmlFor="content-kind">Conteúdo</label>
          <select id="content-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="npc">Personagem não jogador</option>
            <option value="enemy">Inimigo</option>
            <option value="item">Item</option>
          </select>
          <button className="quiet" type="button" onClick={generateEntry} disabled={loading}>Gerar</button>
        </div>
        {kind !== "item" && <div className="generation-actions">
          <label className="select-label" htmlFor="combat-system">Bloco de combate</label>
          <select id="combat-system" value={combatSystem} onChange={(event) => setCombatSystem(event.target.value as CombatSystem | "")}>
            <option value="">Sem bloco</option>
            {combatSystems.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="select-label" htmlFor="combat-tier">Dificuldade</label>
          <select id="combat-tier" value={difficulty} disabled={!combatSystem} onChange={(event) => setDifficulty(event.target.value as CombatTier)}>
            {combatTiers.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>}
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
          {entry && !entry.ai && Object.keys(narratorOnlyDetails(entry.details)).length > 0 && <div className="generation-secret"><strong>Só para você (não é salvo no mundo, porque os jogadores leem a biblioteca):</strong><dl className="generated-details">{Object.entries(narratorOnlyDetails(entry.details)).filter(([, value]) => typeof value !== "object").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl></div>}
          {entry ? (
            <><h2 className="generated-name">{entry.name}</h2><p>{entry.summary}</p><dl className="generated-details">{Object.entries(publicGeneratedEntry(entry).details).filter(([key, value]) => typeof value === "string" || typeof value === "number").map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}</dl><button className="primary" type="button" disabled={loading||!canManage} onClick={()=>void saveGenerated("entry")}>Salvar no mundo</button>
              {(() => { const block = combatBlockOf(entry.details); return block && <div className="generation-secret" aria-label="Bloco de combate">
                <strong>Bloco de combate · {block.system_label} · {block.tier_label} (só para você)</strong>
                <dl className="generated-details">
                  <div><dt>Iniciativa</dt><dd>{block.initiative}</dd></div>
                  <div><dt>{block.health_label}</dt><dd>{block.health}</dd></div>
                  <div><dt>{block.defense_label}</dt><dd>{block.defense}</dd></div>
                  <div><dt>Ataque</dt><dd>{block.attack}</dd></div>
                  <div><dt>Dano</dt><dd>{block.damage}</dd></div>
                  {Object.entries(block.stats).map(([key, value]) => <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{String(value)}</dd></div>)}
                </dl>
                <p>{block.initiative_rule} {block.review_note}</p>
                {canManage && !entry.ai && <div className="generation-actions">
                  {combats.length ? <>
                    <label className="select-label" htmlFor="generation-combat">Combate ativo</label>
                    <select id="generation-combat" value={combatId} onChange={(event) => setCombatId(event.target.value)}>
                      {combats.map((combat) => <option key={combat.id} value={combat.id}>{combat.title}</option>)}
                    </select>
                    <label><input type="checkbox" checked={alsoSaveEntity} onChange={(event) => setAlsoSaveEntity(event.target.checked)} /> Também salvar no mundo</label>
                    <button className="primary" type="button" disabled={loading || !combatId} onClick={() => void insertIntoCombat()}>Inserir no combate</button>
                  </> : <p>Abra uma cena em Modo cena para inserir este bloco no combate.</p>}
                </div>}
              </div>; })()}</>
          ) : <p className="generator-empty">O resultado aparece aqui e pode ser repetido pela seed.</p>}
        </article>
      </div>
    </section>
  );
}
