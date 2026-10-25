import { useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import { Dices, RotateCcw, Trash2 } from "lucide-react";
import { DICE_LIMITS, rollExpression, rollPool, rollSotdl, type DiceRoll } from "@/lib/dice";
import { estimateV5Probabilities, type RollProbabilities } from "@/lib/v5-probability";
import { prefGet, prefSet } from "@/lib/nexus/prefs";
import { NexusContext } from "@/lib/nexus/context";
import { accessTokenProvider, getSupabaseAuth } from "@/lib/nexus/auth";
import {
  fetchSheetProbabilities,
  type SheetProbabilityResult,
} from "@/lib/nexus/v5-sheet-probability";
import type { SheetData } from "@/lib/nexus/sheets";
import { Btn, Empty, Panel, Tag } from "./ui";

const HISTORY_KEY = "dice-roll-history-v1";
const HISTORY_LIMIT = 30;
type RollMode = "expression" | "v5" | "sotdl";

function validHistory(value: unknown): DiceRoll[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is DiceRoll =>
      Boolean(
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.expression === "string" &&
        Number.isFinite(item.total) &&
        Number.isFinite(item.createdAt) &&
        Array.isArray(item.terms) &&
        item.terms.every(
          (term: DiceRoll["terms"][number]) =>
            term &&
            typeof term.label === "string" &&
            Array.isArray(term.rolls) &&
            term.rolls.every(
              (roll: number) => Number.isInteger(roll) && roll > 0 && roll <= DICE_LIMITS.maxFaces,
            ) &&
            Number.isFinite(term.subtotal),
        ),
      ),
    )
    .slice(0, HISTORY_LIMIT);
}

function formatTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
      timestamp,
    );
  } catch {
    return "Horário indisponível";
  }
}

function readInteger(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

function ProbabilityRow({ name, value }: { name: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-2 text-xs text-ink">
        <span>{name}</span>
        <strong>{(value * 100).toFixed(1)}%</strong>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/10" aria-hidden>
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, value * 100)}%` }}
        />
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

export function DicePanel() {
  const nexus = useContext(NexusContext);
  const [mode, setMode] = useState<RollMode>("expression");
  const [expression, setExpression] = useState("2d6");
  const [modifier, setModifier] = useState("0");
  const [poolSize, setPoolSize] = useState("5");
  const [hunger, setHunger] = useState("0");
  const [difficulty, setDifficulty] = useState("3");
  const [willpowerDice, setWillpowerDice] = useState("3");
  const [attribute, setAttribute] = useState("10");
  const [boons, setBoons] = useState("0");
  const [banes, setBanes] = useState("0");
  const [target, setTarget] = useState("10");
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [contextTag, setContextTag] = useState("");
  const [sheetProbability, setSheetProbability] = useState<SheetProbabilityResult | null>(null);
  const [sheetProbabilityLoading, setSheetProbabilityLoading] = useState(false);
  const [sheetProbabilityError, setSheetProbabilityError] = useState("");
  const [label, setLabel] = useState("");
  const [history, setHistory] = useState<DiceRoll[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const connectedSheets =
    nexus?.mode === "connected"
      ? nexus
          .list<SheetData>("character_sheets")
          .filter(
            (sheet) =>
              Number.isInteger(sheet.data.values?.fome) &&
              Number(sheet.data.values.fome) >= 0 &&
              Number(sheet.data.values.fome) <= 5,
          )
      : [];
  const selectedSheet = connectedSheets.find((sheet) => sheet.id === selectedSheetId);
  const linkedSheetId = selectedSheet?.id ?? "";
  const linkedSheetHunger = selectedSheet?.data.values.fome;
  const linkedSheetVersion = selectedSheet?.version;
  const linkedSheetPending = selectedSheet?.pending;
  const accountId = nexus?.user?.id;
  const apiBase = import.meta.env.VITE_NEXUS_API_URL?.trim();

  useEffect(() => {
    if (!linkedSheetId) return;
    setHunger(String(linkedSheetHunger));
  }, [linkedSheetId, linkedSheetHunger]);

  useEffect(() => {
    const controller = new AbortController();
    setSheetProbability(null);
    setSheetProbabilityError("");
    setSheetProbabilityLoading(false);
    if (mode !== "v5" || !linkedSheetId || !accountId) return () => controller.abort();
    const values = [poolSize, difficulty, willpowerDice].map(readInteger);
    if (values.some((value) => value === null)) return () => controller.abort();
    if (!apiBase) {
      setSheetProbabilityError("Configure a URL da API para calcular as condições da ficha.");
      return () => controller.abort();
    }
    const auth = getSupabaseAuth();
    if (!auth) {
      setSheetProbabilityError("Entre na campanha para calcular as condições da ficha.");
      return () => controller.abort();
    }
    setSheetProbabilityLoading(true);
    const timer = window.setTimeout(() => {
      void fetchSheetProbabilities({
        baseUrl: apiBase,
        sheetId: linkedSheetId,
        pool: values[0]!,
        difficulty: values[1]!,
        willpowerDice: values[2]!,
        contextTags: contextTag ? [contextTag] : [],
        getAccessToken: accessTokenProvider(auth, accountId),
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setSheetProbability(result);
        })
        .catch((caught) => {
          if (!controller.signal.aborted)
            setSheetProbabilityError(
              caught instanceof Error ? caught.message : "Não foi possível calcular a ficha.",
            );
        })
        .finally(() => {
          if (!controller.signal.aborted) setSheetProbabilityLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    mode,
    linkedSheetId,
    linkedSheetVersion,
    linkedSheetPending,
    accountId,
    apiBase,
    poolSize,
    difficulty,
    willpowerDice,
    contextTag,
  ]);

  const comparison = useMemo(() => {
    if (mode !== "v5") return null;
    const values = [poolSize, hunger, difficulty, willpowerDice].map(readInteger);
    if (values.some((value) => value === null)) return null;
    try {
      return estimateV5Probabilities(values[0]!, values[1]!, values[2]!, values[3]!);
    } catch {
      return null;
    }
  }, [mode, poolSize, hunger, difficulty, willpowerDice]);

  useEffect(() => {
    let active = true;
    void prefGet<unknown>(HISTORY_KEY)
      .then((saved) => {
        if (active) {
          setHistory(validHistory(saved));
          setReady(true);
        }
      })
      .catch(() => {
        if (active) {
          setError("Não foi possível abrir o histórico local.");
          setReady(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const saveRoll = async (roll: DiceRoll) => {
    const next = [roll, ...history].slice(0, HISTORY_LIMIT);
    try {
      await prefSet(HISTORY_KEY, next);
      setHistory(next);
      setError("");
      setStatus(`Rolagem local registrada. Resultado ${roll.total}.`);
    } catch {
      setError("A rolagem saiu, mas o histórico local não foi salvo.");
      setStatus(`Resultado local: ${roll.total}.`);
    }
  };

  const roll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");
    try {
      const cleanLabel = label.trim();
      if (cleanLabel.length > 48) throw new Error("O rótulo deve ter até 48 caracteres.");
      if (mode === "expression") {
        if (!/^-?\d+$/.test(modifier.trim()))
          throw new Error("O modificador precisa ser um número inteiro.");
        const value = Number(modifier);
        if (!Number.isSafeInteger(value) || Math.abs(value) > DICE_LIMITS.maxModifier)
          throw new Error(
            `O modificador deve ficar entre -${DICE_LIMITS.maxModifier} e ${DICE_LIMITS.maxModifier}.`,
          );
        void saveRoll(rollExpression(expression, value, cleanLabel || undefined));
      } else if (mode === "sotdl") {
        const numbers = [attribute, boons, banes, target].map(readInteger);
        if (numbers.some((value) => value === null)) throw new Error("Atributo, dádivas, perdições e alvo precisam ser números inteiros.");
        void saveRoll(rollSotdl(numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!, cleanLabel || "Shadow of the Demon Lord"));
      } else {
        if (readInteger(poolSize) === null || readInteger(hunger) === null)
          throw new Error("A parada e os dados de fome precisam ser números inteiros.");
        if (Number(poolSize) < 1 || Number(poolSize) > 30)
          throw new Error("A parada deve ter de 1 a 30 dados.");
        if (Number(hunger) > Number(poolSize))
          throw new Error("Dados de fome não podem exceder a parada.");
        if (Number(hunger) > 5) throw new Error("Fome deve ficar entre 0 e 5.");
        void saveRoll(rollPool(Number(poolSize), Number(hunger), cleanLabel || "V5 local"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível rolar os dados.");
    }
  };

  const clearHistory = async () => {
    try {
      await prefSet(HISTORY_KEY, []);
      setHistory([]);
      setError("");
      setStatus("Histórico local apagado.");
    } catch {
      setError("Não foi possível apagar o histórico local.");
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Rolador local" actions={<Tag tone="gold">Somente neste aparelho</Tag>}>
        <p className="mb-4 text-sm text-ink-muted">
          As rolagens usam o gerador seguro do navegador. Nenhum resultado vai para a mesa.
        </p>
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Modo de rolagem">
          <Btn
            type="button"
            variant={mode === "expression" ? "forest" : "outline"}
            role="tab"
            aria-selected={mode === "expression"}
            onClick={() => {
              setMode("expression");
              setError("");
            }}
          >
            NdM + modificador
          </Btn>
          <Btn
            type="button"
            variant={mode === "v5" ? "forest" : "outline"}
            role="tab"
            aria-selected={mode === "v5"}
            onClick={() => {
              setMode("v5");
              setError("");
            }}
          >
            Parada V5 local
          </Btn>
          <Btn
            type="button"
            variant={mode === "sotdl" ? "forest" : "outline"}
            role="tab"
            aria-selected={mode === "sotdl"}
            onClick={() => {
              setMode("sotdl");
              setError("");
            }}
          >
            d20 Demon Lord
          </Btn>
        </div>

        <form className="space-y-3" onSubmit={roll}>
          {mode === "expression" ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="text-sm font-semibold text-ink">
                Expressão
                <input
                  className="field-input mt-1"
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                  maxLength={60}
                  placeholder="2d6+1d4"
                  aria-describedby="dice-expression-hint"
                />
                <span
                  id="dice-expression-hint"
                  className="mt-1 block text-xs font-normal text-ink-muted"
                >
                  Ex.: 2d6+1d4. Até {DICE_LIMITS.maxDice} dados e {DICE_LIMITS.maxTerms} termos.
                </span>
              </label>
              <label className="text-sm font-semibold text-ink">
                Modificador
                <input
                  className="field-input mt-1"
                  type="number"
                  step={1}
                  min={-DICE_LIMITS.maxModifier}
                  max={DICE_LIMITS.maxModifier}
                  value={modifier}
                  onChange={(event) => setModifier(event.target.value)}
                />
              </label>
            </div>
          ) : mode === "sotdl" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["Atributo (1 a 20)", attribute, setAttribute, 1, 20],
                ["Alvo (10 ou a Defesa)", target, setTarget, 1, 40],
                ["Dádivas", boons, setBoons, 0, 10],
                ["Perdições", banes, setBanes, 0, 10],
              ] as const).map(([name, value, setter, min, max]) => (
                <label key={name} className="text-sm font-semibold text-ink">
                  {name}
                  <input
                    className="field-input mt-1"
                    type="number"
                    min={min}
                    max={max}
                    step={1}
                    value={value}
                    onChange={(event) => setter(event.target.value)}
                  />
                </label>
              ))}
              <p className="sm:col-span-2 text-xs text-ink-muted">
                d20 + (atributo − 10). Dádivas e perdições se anulam; das que sobram vale o maior d6.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {connectedSheets.length > 0 && (
                <label className="text-sm font-semibold text-ink sm:col-span-2">
                  Ficha V5 conectada
                  <select
                    className="field-input mt-1"
                    value={selectedSheetId}
                    onChange={(event) => setSelectedSheetId(event.target.value)}
                  >
                    <option value="">Sem ficha, cálculo local</option>
                    {connectedSheets.map((sheet) => (
                      <option key={sheet.id} value={sheet.id}>
                        {sheet.data.name}
                        {sheet.pending ? " (pendente local)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-sm font-semibold text-ink">
                Dados na parada
                <input
                  className="field-input mt-1"
                  type="number"
                  min={1}
                  max={30}
                  step={1}
                  value={poolSize}
                  onChange={(event) => setPoolSize(event.target.value)}
                />
              </label>
              <label className="text-sm font-semibold text-ink">
                Dados de fome
                <input
                  className="field-input mt-1"
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={hunger}
                  disabled={Boolean(selectedSheet)}
                  onChange={(event) => setHunger(event.target.value)}
                />
              </label>
              {selectedSheet && (
                <label className="text-sm font-semibold text-ink sm:col-span-2">
                  Contexto da ação
                  <select
                    className="field-input mt-1"
                    value={contextTag}
                    onChange={(event) => setContextTag(event.target.value)}
                  >
                    <option value="">Sem tag</option>
                    <option value="fisico">Físico</option>
                    <option value="mental">Mental</option>
                    <option value="social">Social</option>
                    <option value="escapar-ameaca">Escapar de ameaça</option>
                  </select>
                </label>
              )}
              <label className="text-sm font-semibold text-ink">
                Dificuldade da ação
                <input
                  className="field-input mt-1"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value)}
                />
              </label>
              <label className="text-sm font-semibold text-ink">
                Dados comuns para Vontade
                <input
                  className="field-input mt-1"
                  type="number"
                  min={0}
                  max={3}
                  step={1}
                  value={willpowerDice}
                  onChange={(event) => setWillpowerDice(event.target.value)}
                />
              </label>
              <p className="sm:col-span-2 text-xs text-ink-muted">
                A regra local conta sucessos em resultados 6 a 10; cada par de 10 concede dois
                sucessos adicionais. Dados de Fome são destacados no histórico.
              </p>
            </div>
          )}
          <label className="block text-sm font-semibold text-ink">
            Rótulo opcional
            <input
              className="field-input mt-1"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={48}
              placeholder={mode === "v5" ? "V5 local" : "Ataque, teste…"}
            />
          </label>
          <Btn type="submit">
            <Dices className="size-4" aria-hidden />
            {mode === "v5" && selectedSheet ? "Rolar sem condições (local)" : "Rolar"}
          </Btn>
          {mode === "v5" && selectedSheet && (
            <p className="text-xs text-ink-muted">
              A rolagem local usa a parada informada acima. Ela não aplica as condições calculadas
              pelo servidor nem registra uma ação na campanha.
            </p>
          )}
        </form>
        {mode === "v5" && (
          <div className="mt-4 space-y-3" aria-label="Probabilidades V5 locais">
            <h3 className="font-semibold text-ink">Risco antes da rolagem</h3>
            {comparison ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProbabilityOutcome title="Sem Vontade" roll={comparison.without_reroll} />
                  <ProbabilityOutcome
                    title={`Com Vontade, até ${comparison.reroll_limit} dados`}
                    roll={comparison.with_reroll}
                  />
                </div>
                <p className="text-xs text-ink-muted">
                  Estimativa local sem condições da ficha. Vontade rerrola dados comuns que
                  falharam; Dados de Fome ficam fora. Sucesso e crítico sujo podem ocorrer juntos.
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                Informe parada de 0 a 30, Fome de 0 a 5 dentro da parada, dificuldade de 1 a 100 e
                Vontade de 0 a 3.
              </p>
            )}
          </div>
        )}
        {mode === "v5" && selectedSheet && (
          <div className="mt-4 space-y-3" aria-label="Probabilidades da ficha no servidor">
            <h3 className="font-semibold text-ink">Condições da ficha no servidor</h3>
            {selectedSheet.pending && (
              <p className="text-xs text-ink-muted">
                A ficha tem alterações locais pendentes. O servidor calcula com a última versão
                confirmada.
              </p>
            )}
            {sheetProbabilityLoading && (
              <p className="text-sm text-ink-muted" role="status">
                Consultando a API…
              </p>
            )}
            {sheetProbabilityError && (
              <p className="text-sm text-destructive" role="status">
                {sheetProbabilityError}
              </p>
            )}
            {sheetProbability && (
              <>
                <p className="text-xs text-ink-muted">
                  Parada ajustada: {sheetProbability.modifier_preview.adjusted_pool} dados. Fome:{" "}
                  {sheetProbability.hunger_dice} dados.
                </p>
                {sheetProbability.modifier_preview.applied.length > 0 && (
                  <ul className="text-xs text-ink-muted">
                    {sheetProbability.modifier_preview.applied.map((effect) => (
                      <li key={effect.id}>
                        {effect.label}: {effect.delta > 0 ? "+" : ""}
                        {effect.delta} dado(s)
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <ProbabilityOutcome
                    title="Ficha, sem Vontade"
                    roll={sheetProbability.without_reroll}
                  />
                  <ProbabilityOutcome
                    title={`Ficha, com Vontade até ${sheetProbability.reroll_limit}`}
                    roll={sheetProbability.with_reroll}
                  />
                </div>
              </>
            )}
          </div>
        )}
        {error && (
          <p className="mt-3 text-sm font-semibold text-destructive" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="mt-3 text-sm font-semibold text-ink" role="status" aria-live="polite">
            {status}
          </p>
        )}
      </Panel>

      <Panel
        title="Histórico"
        actions={
          <Btn
            type="button"
            variant="outline"
            size="sm"
            disabled={!ready || history.length === 0}
            onClick={() => void clearHistory()}
          >
            <Trash2 className="size-4" aria-hidden />
            Apagar histórico
          </Btn>
        }
      >
        {!ready ? (
          <p role="status" className="text-sm text-ink-muted">
            Abrindo histórico local…
          </p>
        ) : history.length === 0 ? (
          <Empty>Nenhuma rolagem neste aparelho.</Empty>
        ) : (
          <ol className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="parchment-inset p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-ink">
                      {entry.label || entry.expression}{" "}
                      <span className="font-normal text-ink-muted">· {entry.expression}</span>
                    </p>
                    <p className="text-xs text-ink-muted">{formatTime(entry.createdAt)} · local</p>
                  </div>
                  <strong className="text-2xl text-ink" aria-label={`Resultado ${entry.total}`}>
                    {entry.total}
                  </strong>
                </div>
                <p className="mt-1 text-sm text-ink">
                  {entry.terms
                    .map(
                      (term) =>
                        `${term.label}: ${term.rolls.length ? term.rolls.join(", ") : term.subtotal}`,
                    )
                    .join(" · ")}
                </p>
                {entry.pool && (
                  <p className="text-sm text-ink">
                    {entry.pool.successes} sucessos · {entry.pool.tens} dez(es)
                    {entry.pool.hungerDice.length
                      ? ` · fome: ${entry.pool.hungerDice.join(", ")}`
                      : ""}
                  </p>
                )}
                {entry.sotdl && (
                  <p className="text-sm text-ink">
                    {entry.sotdl.critical ? "Crítico" : entry.sotdl.success ? "Sucesso" : "Falha"} contra {entry.sotdl.target}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
          <RotateCcw className="size-3.5" aria-hidden />
          Últimas {HISTORY_LIMIT} rolagens, guardadas no IndexedDB local.
        </p>
      </Panel>
    </div>
  );
}
