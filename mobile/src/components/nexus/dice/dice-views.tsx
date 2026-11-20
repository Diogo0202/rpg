import { RotateCcw, Trash2 } from "lucide-react";
import { DICE_LIMITS, type DiceRoll } from "@/lib/dice";
import type { Entity } from "@/lib/nexus/context";
import type { SheetData } from "@/lib/nexus/sheets";
import type { RollProbabilities, V5ProbabilityComparison } from "@/lib/v5-probability";
import type { SheetProbabilityResult } from "@/lib/nexus/v5-sheet-probability";
import { Btn, Empty, Panel } from "../ui";
import { HISTORY_LIMIT, describeTerms, formatTime, type DiceInputs } from "./dice-model";

export type InputSetter = <K extends keyof DiceInputs>(key: K, value: DiceInputs[K]) => void;

function ProbabilityRow({ name, value }: { name: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-xs text-ink">
        <span>{name}</span>
        <strong>{(value * 100).toFixed(1)}%</strong>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/10" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

function ProbabilityOutcome({ title, roll }: { title: string; roll: RollProbabilities }) {
  return (
    <div className="parchment-inset space-y-2 p-3">
      <h3 className="font-semibold text-ink">{title}</h3>
      <ProbabilityRow name="Atingir dificuldade" value={roll.success} />
      <ProbabilityRow name="Crítico sujo" value={roll.messy_critical} />
      <ProbabilityRow name="Falha bestial" value={roll.bestial_failure} />
    </div>
  );
}

type NumberFieldProps = { label: string; value: string; min: number; max: number; disabled?: boolean; onChange: (value: string) => void; className?: string };

function NumberField({ label, value, min, max, disabled, onChange, className = "" }: NumberFieldProps) {
  return (
    <label className={`text-sm font-semibold text-ink ${className}`}>
      {label}
      <input className="field-input mt-1" type="number" min={min} max={max} step={1} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function ExpressionFields({ inputs, set }: { inputs: DiceInputs; set: InputSetter }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
      <label className="text-sm font-semibold text-ink">
        Expressão
        <input className="field-input mt-1" value={inputs.expression} onChange={(event) => set("expression", event.target.value)} maxLength={60} placeholder="2d6+1d4" aria-describedby="dice-expression-hint" />
        <span id="dice-expression-hint" className="mt-1 block text-xs font-normal text-ink-muted">
          Ex.: 2d6+1d4. Até {DICE_LIMITS.maxDice} dados e {DICE_LIMITS.maxTerms} termos.
        </span>
      </label>
      <NumberField label="Modificador" value={inputs.modifier} min={-DICE_LIMITS.maxModifier} max={DICE_LIMITS.maxModifier} onChange={(value) => set("modifier", value)} />
    </div>
  );
}

export function SotdlFields({ inputs, set }: { inputs: DiceInputs; set: InputSetter }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField label="Atributo (1 a 20)" value={inputs.attribute} min={1} max={20} onChange={(value) => set("attribute", value)} />
      <NumberField label="Alvo (10 ou a Defesa)" value={inputs.target} min={1} max={40} onChange={(value) => set("target", value)} />
      <NumberField label="Dádivas" value={inputs.boons} min={0} max={10} onChange={(value) => set("boons", value)} />
      <NumberField label="Perdições" value={inputs.banes} min={0} max={10} onChange={(value) => set("banes", value)} />
      <p className="sm:col-span-2 text-xs text-ink-muted">d20 + (atributo − 10). Dádivas e perdições se anulam; das que sobram vale o maior d6.</p>
    </div>
  );
}

export function HunterFields({ inputs, set }: { inputs: DiceInputs; set: InputSetter }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <NumberField label="Dados comuns" value={inputs.poolSize} min={1} max={30} onChange={(value) => set("poolSize", value)} />
      <NumberField label="Desespero atual" value={inputs.desperation} min={0} max={5} onChange={(value) => set("desperation", value)} />
      <NumberField label="Dificuldade" value={inputs.difficulty} min={1} max={69} onChange={(value) => set("difficulty", value)} />
      <label className="flex items-center gap-2 text-sm font-semibold text-ink"><input type="checkbox" checked={inputs.useDesperation} onChange={(event) => set("useDesperation", event.target.checked)} />Somar dados de Desespero</label>
      <p className="sm:col-span-2 text-xs text-ink-muted">Laranja: dados comuns. Preto: Desespero. O resultado é local neste aparelho.</p>
    </div>
  );
}

const CONTEXT_TAGS = [["fisico", "Físico"], ["mental", "Mental"], ["social", "Social"], ["escapar-ameaca", "Escapar de ameaça"]] as const;

type V5FieldsProps = {
  inputs: DiceInputs;
  set: InputSetter;
  sheets: Entity<SheetData>[];
  selectedSheetId: string;
  onSelectSheet: (id: string) => void;
  contextTag: string;
  onContextTag: (tag: string) => void;
};

export function V5Fields({ inputs, set, sheets, selectedSheetId, onSelectSheet, contextTag, onContextTag }: V5FieldsProps) {
  const linked = sheets.some((sheet) => sheet.id === selectedSheetId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {sheets.length > 0 && (
        <label className="text-sm font-semibold text-ink sm:col-span-2">
          Ficha V5 conectada
          <select className="field-input mt-1" value={selectedSheetId} onChange={(event) => onSelectSheet(event.target.value)}>
            <option value="">Sem ficha, cálculo local</option>
            {sheets.map((sheet) => (
              <option key={sheet.id} value={sheet.id}>{sheet.data.name}{sheet.pending ? " (pendente local)" : ""}</option>
            ))}
          </select>
        </label>
      )}
      <NumberField label="Dados na parada" value={inputs.poolSize} min={1} max={30} onChange={(value) => set("poolSize", value)} />
      <NumberField label="Dados de fome" value={inputs.hunger} min={0} max={5} disabled={linked} onChange={(value) => set("hunger", value)} />
      {linked && (
        <label className="text-sm font-semibold text-ink sm:col-span-2">
          Contexto da ação
          <select className="field-input mt-1" value={contextTag} onChange={(event) => onContextTag(event.target.value)}>
            <option value="">Sem tag</option>
            {CONTEXT_TAGS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      )}
      <NumberField label="Dificuldade da ação" value={inputs.difficulty} min={1} max={100} onChange={(value) => set("difficulty", value)} />
      <NumberField label="Dados comuns para Vontade" value={inputs.willpowerDice} min={0} max={3} onChange={(value) => set("willpowerDice", value)} />
      <p className="sm:col-span-2 text-xs text-ink-muted">
        A regra local conta sucessos em resultados 6 a 10; cada par de 10 concede dois sucessos adicionais. Dados de Fome são destacados no histórico.
      </p>
    </div>
  );
}

export function LocalChances({ comparison }: { comparison: V5ProbabilityComparison | null }) {
  return (
    <div className="mt-4 space-y-3" aria-label="Probabilidades V5 locais">
      <h3 className="font-semibold text-ink">Risco antes da rolagem</h3>
      {comparison ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <ProbabilityOutcome title="Sem Vontade" roll={comparison.without_reroll} />
            <ProbabilityOutcome title={`Com Vontade, até ${comparison.reroll_limit} dados`} roll={comparison.with_reroll} />
          </div>
          <p className="text-xs text-ink-muted">
            Estimativa local sem condições da ficha. Vontade compara escolhas de até três dados comuns para buscar sucesso e, em empate, reduzir crítico sujo. Dados de Fome ficam fora. Sucesso e crítico sujo podem ocorrer juntos.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-muted">Informe parada de 0 a 30, Fome de 0 a 5 dentro da parada, dificuldade de 1 a 100 e Vontade de 0 a 3.</p>
      )}
    </div>
  );
}

type SheetChancesProps = { pending: boolean; loading: boolean; error: string; result: SheetProbabilityResult | null };

export function SheetChances({ pending, loading, error, result }: SheetChancesProps) {
  return (
    <div className="mt-4 space-y-3" aria-label="Probabilidades da ficha no servidor">
      <h3 className="font-semibold text-ink">Condições da ficha no servidor</h3>
      {pending && <p className="text-xs text-ink-muted">A ficha tem alterações locais pendentes. O servidor calcula com a última versão confirmada.</p>}
      {loading && <p className="text-sm text-ink-muted" role="status">Consultando a API…</p>}
      {error && <p className="text-sm text-destructive" role="status">{error}</p>}
      {result && (
        <>
          <p className="text-xs text-ink-muted">
            Parada ajustada: {result.modifier_preview.adjusted_pool} dados. Fome:{" "}{result.hunger_dice} dados.
          </p>
          {result.modifier_preview.applied.length > 0 && (
            <ul className="text-xs text-ink-muted">
              {result.modifier_preview.applied.map((effect) => (
                <li key={effect.id}>{effect.label}: {effect.delta > 0 ? "+" : ""}{effect.delta} dado(s)</li>
              ))}
            </ul>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <ProbabilityOutcome title="Ficha, sem Vontade" roll={result.without_reroll} />
            <ProbabilityOutcome title={`Ficha, com Vontade até ${result.reroll_limit}`} roll={result.with_reroll} />
          </div>
        </>
      )}
    </div>
  );
}

function HistoryEntry({ entry }: { entry: DiceRoll }) {
  return (
    <li className="parchment-inset p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink">
            {entry.label || entry.expression}{" "}
            <span className="font-normal text-ink-muted">· {entry.expression}</span>
          </p>
          <p className="text-xs text-ink-muted">{formatTime(entry.createdAt)} · local</p>
        </div>
        <strong className="text-2xl text-ink" aria-label={`Resultado ${entry.total}`}>{entry.total}</strong>
      </div>
      <p className="mt-1 text-sm text-ink">{describeTerms(entry)}</p>
      {entry.pool && (
        <p className="text-sm text-ink">
          {entry.pool.successes} sucessos · {entry.pool.tens} dez(es)
          {entry.pool.hungerDice.length ? ` · fome: ${entry.pool.hungerDice.join(", ")}` : ""}
        </p>
      )}
      {entry.sotdl && (
        <p className="text-sm text-ink">
          {entry.sotdl.critical ? "Crítico" : entry.sotdl.success ? "Sucesso" : "Falha"} contra {entry.sotdl.target}
        </p>
      )}
    </li>
  );
}

export function HistoryPanel({ history, ready, onClear }: { history: DiceRoll[]; ready: boolean; onClear: () => void }) {
  return (
    <Panel
      title="Histórico"
      actions={
        <Btn type="button" variant="outline" size="sm" disabled={!ready || history.length === 0} onClick={onClear}>
          <Trash2 className="size-4" aria-hidden />
          Apagar histórico
        </Btn>
      }
    >
      {!ready ? (
        <p role="status" className="text-sm text-ink-muted">Abrindo histórico local…</p>
      ) : history.length === 0 ? (
        <Empty>Nenhuma rolagem neste aparelho.</Empty>
      ) : (
        <ol className="space-y-2">{history.map((entry) => <HistoryEntry key={entry.id} entry={entry} />)}</ol>
      )}
      <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
        <RotateCcw className="size-3.5" aria-hidden />
        Últimas {HISTORY_LIMIT} rolagens, guardadas no IndexedDB local.
      </p>
    </Panel>
  );
}
