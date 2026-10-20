import { useEffect, useState, type FormEvent } from "react";
import { Dices, RotateCcw, Trash2 } from "lucide-react";
import { DICE_LIMITS, rollExpression, rollPool, type DiceRoll } from "@/lib/dice";
import { prefGet, prefSet } from "@/lib/nexus/prefs";
import { Btn, Empty, Panel, Tag } from "./ui";

const HISTORY_KEY = "dice-roll-history-v1";
const HISTORY_LIMIT = 30;
type RollMode = "expression" | "v5";

function validHistory(value: unknown): DiceRoll[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is DiceRoll => Boolean(item && typeof item === "object"
    && typeof item.id === "string" && typeof item.expression === "string"
    && Number.isFinite(item.total) && Number.isFinite(item.createdAt)
    && Array.isArray(item.terms) && item.terms.every((term: DiceRoll["terms"][number]) => term && typeof term.label === "string"
      && Array.isArray(term.rolls) && term.rolls.every((roll: number) => Number.isInteger(roll) && roll > 0 && roll <= DICE_LIMITS.maxFaces)
      && Number.isFinite(term.subtotal)))).slice(0, HISTORY_LIMIT);
}

function formatTime(timestamp: number): string {
  try { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(timestamp); }
  catch { return "Horário indisponível"; }
}

export function DicePanel() {
  const [mode, setMode] = useState<RollMode>("expression");
  const [expression, setExpression] = useState("2d6");
  const [modifier, setModifier] = useState("0");
  const [poolSize, setPoolSize] = useState("5");
  const [hunger, setHunger] = useState("0");
  const [label, setLabel] = useState("");
  const [history, setHistory] = useState<DiceRoll[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    void prefGet<unknown>(HISTORY_KEY).then((saved) => {
      if (active) { setHistory(validHistory(saved)); setReady(true); }
    }).catch(() => {
      if (active) { setError("Não foi possível abrir o histórico local."); setReady(true); }
    });
    return () => { active = false; };
  }, []);

  const saveRoll = async (roll: DiceRoll) => {
    const next = [roll, ...history].slice(0, HISTORY_LIMIT);
    try {
      await prefSet(HISTORY_KEY, next);
      setHistory(next); setError(""); setStatus(`Rolagem local registrada. Resultado ${roll.total}.`);
    } catch {
      setError("A rolagem saiu, mas o histórico local não foi salvo.");
      setStatus(`Resultado local: ${roll.total}.`);
    }
  };

  const roll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setStatus("");
    try {
      const cleanLabel = label.trim();
      if (cleanLabel.length > 48) throw new Error("O rótulo deve ter até 48 caracteres.");
      if (mode === "expression") {
        if (!/^-?\d+$/.test(modifier.trim())) throw new Error("O modificador precisa ser um número inteiro.");
        const value = Number(modifier);
        if (!Number.isSafeInteger(value) || Math.abs(value) > DICE_LIMITS.maxModifier) throw new Error(`O modificador deve ficar entre -${DICE_LIMITS.maxModifier} e ${DICE_LIMITS.maxModifier}.`);
        void saveRoll(rollExpression(expression, value, cleanLabel || undefined));
      } else {
        if (!/^\d+$/.test(poolSize) || !/^\d+$/.test(hunger)) throw new Error("A parada e os dados de fome precisam ser números inteiros.");
        if (Number(poolSize) < 1 || Number(poolSize) > 30) throw new Error("A parada deve ter de 1 a 30 dados.");
        if (Number(hunger) > Number(poolSize)) throw new Error("Dados de fome não podem exceder a parada.");
        void saveRoll(rollPool(Number(poolSize), Number(hunger), cleanLabel || "V5 local"));
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível rolar os dados."); }
  };

  const clearHistory = async () => {
    try {
      await prefSet(HISTORY_KEY, []);
      setHistory([]); setError(""); setStatus("Histórico local apagado.");
    } catch { setError("Não foi possível apagar o histórico local."); }
  };

  return <div className="space-y-4">
    <Panel title="Rolador local" actions={<Tag tone="gold">Somente neste aparelho</Tag>}>
      <p className="mb-4 text-sm text-ink-muted">As rolagens usam o gerador seguro do navegador. Nenhum resultado vai para a mesa.</p>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Modo de rolagem">
        <Btn type="button" variant={mode === "expression" ? "forest" : "outline"} role="tab" aria-selected={mode === "expression"} onClick={() => { setMode("expression"); setError(""); }}>NdM + modificador</Btn>
        <Btn type="button" variant={mode === "v5" ? "forest" : "outline"} role="tab" aria-selected={mode === "v5"} onClick={() => { setMode("v5"); setError(""); }}>Parada V5 local</Btn>
      </div>

      <form className="space-y-3" onSubmit={roll}>
        {mode === "expression" ? <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <label className="text-sm font-semibold text-ink">Expressão
            <input className="field-input mt-1" value={expression} onChange={(event) => setExpression(event.target.value)} maxLength={60} placeholder="2d6+1d4" aria-describedby="dice-expression-hint" />
            <span id="dice-expression-hint" className="mt-1 block text-xs font-normal text-ink-muted">Ex.: 2d6+1d4. Até {DICE_LIMITS.maxDice} dados e {DICE_LIMITS.maxTerms} termos.</span>
          </label>
          <label className="text-sm font-semibold text-ink">Modificador
            <input className="field-input mt-1" type="number" step={1} min={-DICE_LIMITS.maxModifier} max={DICE_LIMITS.maxModifier} value={modifier} onChange={(event) => setModifier(event.target.value)} />
          </label>
        </div> : <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold text-ink">Dados na parada
            <input className="field-input mt-1" type="number" min={1} max={30} step={1} value={poolSize} onChange={(event) => setPoolSize(event.target.value)} />
          </label>
          <label className="text-sm font-semibold text-ink">Dados de fome
            <input className="field-input mt-1" type="number" min={0} max={30} step={1} value={hunger} onChange={(event) => setHunger(event.target.value)} />
          </label>
          <p className="sm:col-span-2 text-xs text-ink-muted">A regra local conta sucessos em resultados 6–10; cada par de 10 concede dois sucessos adicionais. Dados de fome são destacados no histórico.</p>
        </div>}
        <label className="block text-sm font-semibold text-ink">Rótulo opcional
          <input className="field-input mt-1" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={48} placeholder={mode === "v5" ? "V5 local" : "Ataque, teste…"} />
        </label>
        <Btn type="submit"><Dices className="size-4" aria-hidden />Rolar</Btn>
      </form>
      {error && <p className="mt-3 text-sm font-semibold text-destructive" role="alert">{error}</p>}
      {status && <p className="mt-3 text-sm font-semibold text-ink" role="status" aria-live="polite">{status}</p>}
    </Panel>

    <Panel title="Histórico" actions={<Btn type="button" variant="outline" size="sm" disabled={!ready || history.length === 0} onClick={() => void clearHistory()}><Trash2 className="size-4" aria-hidden />Apagar histórico</Btn>}>
      {!ready ? <p role="status" className="text-sm text-ink-muted">Abrindo histórico local…</p> : history.length === 0 ? <Empty>Nenhuma rolagem neste aparelho.</Empty> : <ol className="space-y-2">
        {history.map((entry) => <li key={entry.id} className="parchment-inset p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="font-semibold text-ink">{entry.label || entry.expression} <span className="font-normal text-ink-muted">· {entry.expression}</span></p><p className="text-xs text-ink-muted">{formatTime(entry.createdAt)} · local</p></div>
            <strong className="text-2xl text-ink" aria-label={`Resultado ${entry.total}`}>{entry.total}</strong>
          </div>
          <p className="mt-1 text-sm text-ink">{entry.terms.map((term) => `${term.label}: ${term.rolls.length ? term.rolls.join(", ") : term.subtotal}`).join(" · ")}</p>
          {entry.pool && <p className="text-sm text-ink">{entry.pool.successes} sucessos · {entry.pool.tens} dez(es){entry.pool.hungerDice.length ? ` · fome: ${entry.pool.hungerDice.join(", ")}` : ""}</p>}
        </li>)}
      </ol>}
      <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted"><RotateCcw className="size-3.5" aria-hidden />Últimas {HISTORY_LIMIT} rolagens, guardadas no IndexedDB local.</p>
    </Panel>
  </div>;
}
