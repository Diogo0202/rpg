"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { parseTags, useCharacterSession, type CharacterEffect, type SessionCharacter } from "../lib/character-session";
import { createClient } from "../lib/supabase/client";

export type ModifierPreview = {
  base_pool: number;
  total_delta: number;
  adjusted_pool: number;
  applied: { id: string; label: string; delta: number; source_note: string | null }[];
  skipped: { id: string; reason: string }[];
  clipped: boolean;
};

export async function authenticatedPost(path: string, payload: unknown, signal?: AbortSignal) {
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (!api) throw new Error("A API não está configurada.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre na campanha para calcular a rolagem.");
  const response = await fetch(`${api}${path}`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("A API recusou os dados. Confira a sessão, a parada e os efeitos.");
  return response.json();
}

export function ModifierExplanation({ preview }: { preview: ModifierPreview }) {
  const reasons: Record<string, string> = { disabled: "desativado", expired: "duração encerrada", exempt: "exceção da ação", out_of_scope: "fora do escopo" };
  return <div className="modifier-explanation">
    <p><b>{preview.base_pool}</b> dados base {preview.total_delta >= 0 ? "+" : ""}{preview.total_delta} = <b>{preview.adjusted_pool}</b> dados</p>
    {preview.applied.map((effect) => <p key={effect.id} title={effect.source_note ?? effect.label}>{effect.delta >= 0 ? "+" : ""}{effect.delta}: {effect.label}{effect.source_note ? ` (${effect.source_note})` : ""}</p>)}
    {preview.skipped.length > 0 && <details><summary>Efeitos ignorados ({preview.skipped.length})</summary>{preview.skipped.map((effect) => <p key={effect.id}>{effect.id}: {reasons[effect.reason] ?? effect.reason}</p>)}</details>}
    {preview.clipped && <p>Parada limitada ao intervalo de 0 a 30 dados.</p>}
  </div>;
}

export function CharacterEffectsPanel({ campaignId, canEdit }: { campaignId: string; canEdit: boolean }) {
  const { character, acceptSavedCharacter, contextTags, setContextTags } = useCharacterSession();
  const currentCharacterId = useRef(character?.id);
  currentCharacterId.current = character?.id;
  const [contextInput, setContextInput] = useState(contextTags.join(", "));
  const [contextValid, setContextValid] = useState(true);
  const [label, setLabel] = useState("");
  const [delta, setDelta] = useState(-2);
  const [scope, setScope] = useState("");
  const [exceptions, setExceptions] = useState("");
  const [duration, setDuration] = useState("");
  const [source, setSource] = useState("");
  const [pool, setPool] = useState(6);
  const [sides, setSides] = useState(10);
  const [preview, setPreview] = useState<ModifierPreview | null>(null);
  const [roll, setRoll] = useState<{ rolls: number[]; total: number } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const effects = character?.effects;
  const rollContext = useRef("");
  rollContext.current = JSON.stringify({ id: character?.id, effects, pool, sides, contextTags });

  useEffect(() => {
    setRoll(null);
    setPreview(null);
    if (!character || !contextValid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const result = await authenticatedPost("/api/v1/modifiers/preview", { base_pool: pool, context_tags: contextTags, effects: effects ?? [] }, controller.signal) as ModifierPreview;
        if (!controller.signal.aborted) { setPreview(result); setMessage(""); }
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Falha no cálculo.");
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [character?.id, effects, pool, sides, contextTags, contextValid]);

  async function saveEffects(next: CharacterEffect[]) {
    if (!character || !canEdit) return;
    const selected = character;
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await createClient().from("character_sheets")
        .update({ effects: next }).eq("id", selected.id).eq("campaign_id", campaignId).eq("version", selected.version)
        .select("id,name,version,values,effects").maybeSingle();
      if (error || !data) throw new Error("Não foi possível salvar. Atualize a ficha se ela mudou em outra sessão.");
      acceptSavedCharacter(data as SessionCharacter);
      if (currentCharacterId.current === selected.id) setMessage("Efeitos salvos na ficha.");
    } catch (error) {
      if (currentCharacterId.current === selected.id) setMessage(error instanceof Error ? error.message : "Falha ao salvar efeitos.");
    } finally { setBusy(false); }
  }

  function addEffect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!character || !label.trim() || !source.trim()) return;
    const scenes = duration === "" ? null : Number(duration);
    if (scenes !== null && (!Number.isInteger(scenes) || scenes < 1 || scenes > 1000)) { setMessage("Informe de 1 a 1000 cenas, ou deixe a duração em branco."); return; }
    try {
      const next: CharacterEffect = {
        id: crypto.randomUUID(), label: label.trim(), delta, enabled: true,
        applies_to_tags: parseTags(scope), exempt_tags: parseTags(exceptions), remaining_scenes: scenes, source_note: source.trim(),
      };
      void saveEffects([...(effects ?? []), next]);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Confira as tags."); }
  }

  async function rollPool() {
    if (!character) return;
    const selectedId = character.id;
    const selectedContext = rollContext.current;
    setBusy(true); setMessage(""); setRoll(null);
    try {
      const result = await authenticatedPost("/api/v1/modifiers/roll", { base_pool: pool, die_sides: sides, context_tags: contextTags, effects: effects ?? [] }) as { preview: ModifierPreview; rolls: number[]; total: number };
      if (currentCharacterId.current === selectedId && selectedContext === rollContext.current) { setPreview(result.preview); setRoll(result); }
    } catch (error) { if (currentCharacterId.current === selectedId && selectedContext === rollContext.current) setMessage(error instanceof Error ? error.message : "Falha na rolagem."); }
    finally { setBusy(false); }
  }

  if (!character) return <section className="content generation-card"><h2>Condições e modificadores</h2><p>Selecione uma ficha salva na barra da sessão para acompanhar seus efeitos.</p></section>;

  return <section className="content effects-layout" aria-busy={busy}>
    <article className="generation-card">
      <p className="eyebrow">ESTADO DE {character.name.toUpperCase()}</p><h2>Condições em jogo</h2>
      <p>Registre a penalidade ou o bônus aprovado para a mesa. Tags definem em quais ações o efeito entra e quais ações são exceções.</p>
      <div className="effect-list">
        {(effects ?? []).map((effect) => <div className="effect-row" key={effect.id}>
          <label><input type="checkbox" checked={effect.enabled && effect.remaining_scenes !== 0} disabled={busy || !canEdit || effect.remaining_scenes === 0} onChange={(event) => void saveEffects((effects ?? []).map((item) => item.id === effect.id ? { ...item, enabled: event.target.checked } : item))} /> {effect.label} ({effect.delta >= 0 ? "+" : ""}{effect.delta})</label>
          <p>{effect.remaining_scenes === null ? "Até remover" : `${effect.remaining_scenes} cenas restantes`} · {effect.source_note}</p>
          <small>Escopo: {effect.applies_to_tags.join(", ") || "todas as ações"}. Exceções: {effect.exempt_tags.join(", ") || "nenhuma"}.</small>
          <button className="quiet" type="button" disabled={busy || !canEdit} onClick={() => void saveEffects((effects ?? []).filter((item) => item.id !== effect.id))}>Remover {effect.label}</button>
        </div>)}
        {effects?.length === 0 && <p>Nenhuma condição registrada.</p>}
      </div>
      <button className="quiet" type="button" disabled={busy || !canEdit || !effects?.some((effect) => effect.enabled && effect.remaining_scenes !== null && effect.remaining_scenes > 0)} onClick={() => void saveEffects((effects ?? []).map((effect) => effect.enabled && effect.remaining_scenes !== null ? { ...effect, remaining_scenes: Math.max(0, effect.remaining_scenes - 1) } : effect))}>Encerrar uma cena</button>
      <form onSubmit={addEffect} className="effect-form">
        <h3>Adicionar efeito</h3>
        <label>Condição ou Ressonância<input value={label} maxLength={120} required onChange={(event) => setLabel(event.target.value)} placeholder="Nome aprovado pela mesa" /></label>
        <label>Modificador em dados<input type="number" min={-10} max={10} value={delta} required onChange={(event) => setDelta(Number(event.target.value))} /></label>
        <label>Tags de aplicação, separadas por vírgula<input value={scope} maxLength={500} onChange={(event) => setScope(event.target.value)} placeholder="Vazio aplica em todas as ações" /></label>
        <label>Tags de exceção<input value={exceptions} maxLength={500} onChange={(event) => setExceptions(event.target.value)} placeholder="Ex.: escapar-ameaca" /></label>
        <label>Cenas restantes<input type="number" min={1} max={1000} value={duration} onChange={(event) => setDuration(event.target.value)} placeholder="Vazio: até remover" /></label>
        <label>Origem da regra<input value={source} maxLength={500} required onChange={(event) => setSource(event.target.value)} placeholder="Livro e página ou regra da mesa" /></label>
        <button className="primary" type="submit" disabled={busy || !canEdit || (effects?.length ?? 0) >= 30}>Salvar efeito</button>
      </form>
    </article>
    <article className="generation-card">
      <p className="eyebrow">ROLADOR COM MODIFICADORES</p><h2>Confira a parada</h2>
      <label>Tags da ação<input value={contextInput} maxLength={500} aria-invalid={!contextValid} onChange={(event) => {
        setContextInput(event.target.value);
        try { setContextTags(parseTags(event.target.value)); setContextValid(true); }
        catch (error) { setContextValid(false); setMessage(error instanceof Error ? error.message : "Confira as tags."); }
      }} placeholder="Ex.: escapar-ameaca, potencia" /></label>
      <p className="notice">As tags desta ação também entram nas rolagens da ficha e na previsão V5. Bônus de Ressonância devem citar a intensidade e a duração aprovadas para a mesa.</p>
      <label>Dados base<input type="number" min={0} max={30} value={pool} onChange={(event) => setPool(Number(event.target.value))} /></label>
      <label>Faces do dado<input type="number" min={2} max={100} value={sides} onChange={(event) => setSides(Number(event.target.value))} /></label>
      {preview && <ModifierExplanation preview={preview} />}
      <button type="button" className="primary" disabled={busy || !contextValid || !preview || preview.adjusted_pool === 0} onClick={() => void rollPool()}>Rolar parada ajustada</button>
      <p className="notice">Rolagem comum por soma. Este rolador não classifica Dados de Fome, críticos sujos ou falhas bestiais.</p>
      {roll && <p className="effect-roll" role="status">{roll.rolls.join(" + ")} = <b>{roll.total}</b></p>}
      <p role="status" aria-live="polite">{message}</p>
    </article>
  </section>;
}
