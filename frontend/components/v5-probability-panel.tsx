"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { useCharacterSession } from "../lib/character-session";
import { ModifierExplanation, type ModifierPreview } from "./character-effects-panel";
import { deriveDamageState } from "./v5-action-panel";

type Roll = { success: number; messy_critical: number; bestial_failure: number };
type Comparison = { without_reroll: Roll; with_reroll: Roll; reroll_limit: number; modifier_preview: ModifierPreview; hunger_dice: number };
const apiBase = process.env.NEXT_PUBLIC_API_URL;

function Chance({ title, value, tone }: { title: string; value: number; tone: string }) {
  const percent = value * 100;
  return <div className="chance-row"><div><span>{title}</span><b>{percent.toFixed(1)}%</b></div><div className="chance-track"><i className={tone} style={{ width: `${Math.min(100, percent)}%` }} /></div></div>;
}

function Outcome({ title, roll }: { title: string; roll: Roll }) {
  return <article className="generation-card probability-outcome"><h3>{title}</h3><Chance title="Atingir dificuldade" value={roll.success} tone="success" /><Chance title="Crítico sujo" value={roll.messy_critical} tone="messy" /><Chance title="Falha bestial" value={roll.bestial_failure} tone="bestial" /></article>;
}

export function V5ProbabilityPanel() {
  const { character, contextTags } = useCharacterSession();
  const [pool, setPool] = useState(6);
  const [hunger, setHunger] = useState(2);
  const [difficulty, setDifficulty] = useState(3);
  const [rerolls, setRerolls] = useState(3);
  const [result, setResult] = useState<Comparison | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hungerValue = character?.values.fome;
    if (typeof hungerValue === "number" && Number.isInteger(hungerValue) && hungerValue >= 0 && hungerValue <= 5) setHunger(hungerValue);
  }, [character?.id, character?.values.fome]);

  const calculate = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setMessage("");
    try {
      if (!apiBase) throw new Error("Configure NEXT_PUBLIC_API_URL para acessar a API.");
      const { data } = await createClient().auth.getSession();
      if (!data.session) throw new Error("Entre na campanha para calcular a rolagem.");
      const response = await fetch(`${apiBase}/api/v1/v5/probabilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ pool, hunger, difficulty, willpower_dice: rerolls, effects: character?.effects ?? [], context_tags: contextTags, damage: character ? deriveDamageState(character.values) : null }),
        signal,
      });
      if (!response.ok) throw new Error("Confira os valores da parada e tente de novo.");
      const comparison = (await response.json()) as Comparison;
      if (!signal.aborted) setResult(comparison);
    } catch (error) {
      if (signal.aborted) return;
      setMessage(error instanceof Error ? error.message : "Não foi possível calcular as probabilidades.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [pool, hunger, difficulty, rerolls, character?.id, character?.values, character?.effects, contextTags]);

  useEffect(() => {
    const controller = new AbortController();
    const valid = Number.isInteger(pool) && pool >= 0 && pool <= 30
      && Number.isInteger(hunger) && hunger >= 0 && hunger <= 5
      && Number.isInteger(difficulty) && difficulty >= 1 && difficulty <= 100
      && Number.isInteger(rerolls) && rerolls >= 0 && rerolls <= 3;

    if (!valid) {
      setResult(null);
      setMessage("Informe valores inteiros dentro dos limites exibidos.");
      setLoading(false);
      return () => controller.abort();
    }

    setResult(null);
    const timer = window.setTimeout(() => void calculate(controller.signal), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pool, hunger, difficulty, rerolls, calculate]);

  return <section className="content probability-layout">
    <article className="generation-card probability-controls">
      <p className="eyebrow">MOTOR DE PROBABILIDADE / V5</p>
      <h2>Leia o risco antes de agir.</h2>
      <p>A distribuição conta sucessos, pares de 10, dados de Fome e falhas bestiais. Ajuste os números para a rolagem desta cena.</p>
      <label>Parada de dados<input type="number" min={0} max={30} value={pool} onChange={(event) => setPool(Number(event.target.value))} /></label>
      <label>Fome<input type="number" min={0} max={5} value={hunger} onChange={(event) => setHunger(Number(event.target.value))} /></label>
      <p className="probability-note">{character ? `Condições de ${character.name}. Tags: ${contextTags.join(", ") || "ação sem tags"}.` : "Simulação sem personagem e sem condições."}</p>
      {result && <><ModifierExplanation preview={result.modifier_preview} /><p className="probability-note">{result.hunger_dice} dados de Fome na parada ajustada.</p></>}
      <label>Dificuldade<input type="number" min={1} max={100} value={difficulty} onChange={(event) => setDifficulty(Number(event.target.value))} /></label>
      <label>Dados comuns para Vontade<input type="number" min={0} max={3} value={rerolls} onChange={(event) => setRerolls(Number(event.target.value))} /></label>
      <p className="probability-note" role="status">{loading ? "Atualizando probabilidades…" : "As probabilidades são atualizadas ao mudar os valores."}</p>
      {message && <p className="auth-message" role="status">{message}</p>}
      <p className="probability-note">A comparação presume que Vontade rerrola até {rerolls} dados comuns que falharam. Dados de Fome ficam fora da rerrolagem.</p>
    </article>
    <div className="probability-results">
      {result ? <><Outcome title="Sem rerrolagem" roll={result.without_reroll} /><Outcome title={`Com Vontade · até ${result.reroll_limit} dados`} roll={result.with_reroll} /><p className="probability-note">Crítico sujo e sucesso são eventos simultâneos. As probabilidades das linhas não devem ser somadas.</p></> : <article className="generation-card generator-empty">Defina a parada da cena e calcule a curva para comparar os riscos.</article>}
    </div>
  </section>;
}
