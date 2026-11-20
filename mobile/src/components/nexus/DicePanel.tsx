import { useContext, useEffect, useMemo, useState, type FormEvent } from "react";
import { Dices } from "lucide-react";
import type { DiceRoll } from "@/lib/dice";
import type { RollContext } from "@/lib/dice-roller";
import { NexusContext } from "@/lib/nexus/context";
import type { SheetData } from "@/lib/nexus/sheets";
import { estimateV5Probabilities } from "@/lib/v5-probability";
import { Btn, Panel, Tag } from "./ui";
import { DiceRollStage } from "./DiceRollStage";
import { DiceTray3D, canShowTray } from "./DiceTray3D";
import { INITIAL_INPUTS, LABEL_LIMIT, ROLL_MODES, readIntegers, rollFor, type DiceInputs, type RollMode } from "./dice/dice-model";
import {
  ExpressionFields,
  HistoryPanel,
  HunterFields,
  LocalChances,
  SheetChances,
  SotdlFields,
  V5Fields,
  type InputSetter,
} from "./dice/dice-views";
import { useRollHistory } from "./dice/use-roll-history";
import { useSheetProbability } from "./dice/use-sheet-probability";

/** Fichas conectadas com Fome válida (0 a 5), as únicas que o servidor sabe calcular. */
function hasValidHunger(sheet: { data: SheetData }): boolean {
  const hunger = sheet.data.values?.fome;
  return Number.isInteger(hunger) && Number(hunger) >= 0 && Number(hunger) <= 5;
}

export function DicePanel() {
  const nexus = useContext(NexusContext);
  const [mode, setMode] = useState<RollMode>("expression");
  const [inputs, setInputs] = useState<DiceInputs>(INITIAL_INPUTS);
  const [selectedSheetId, setSelectedSheetId] = useState("");
  const [contextTag, setContextTag] = useState("");
  const [lastRoll, setLastRoll] = useState<{ roll: DiceRoll; context: RollContext } | null>(null);
  const [trayRoll, setTrayRoll] = useState<DiceRoll | null>(null);
  const history = useRollHistory();
  const set: InputSetter = (key, value) => setInputs((prior) => ({ ...prior, [key]: value }));

  const connectedSheets = nexus?.mode === "connected" ? nexus.list<SheetData>("character_sheets").filter(hasValidHunger) : [];
  const selectedSheet = connectedSheets.find((sheet) => sheet.id === selectedSheetId);
  const linkedId = selectedSheet?.id ?? "";
  const linkedHunger = selectedSheet?.data.values.fome;

  useEffect(() => {
    if (linkedId) setInputs((prior) => ({ ...prior, hunger: String(linkedHunger) }));
  }, [linkedId, linkedHunger]);

  const sheetChances = useSheetProbability({
    enabled: mode === "v5",
    sheetId: linkedId,
    sheetVersion: selectedSheet?.version,
    sheetPending: selectedSheet?.pending,
    accountId: nexus?.user?.id,
    pool: inputs.poolSize,
    difficulty: inputs.difficulty,
    willpowerDice: inputs.willpowerDice,
    contextTag,
  });

  const comparison = useMemo(() => {
    if (mode !== "v5") return null;
    const numbers = readIntegers([inputs.poolSize, inputs.hunger, inputs.difficulty, inputs.willpowerDice]);
    if (!numbers) return null;
    try {
      return estimateV5Probabilities(numbers[0]!, numbers[1]!, numbers[2]!, numbers[3]!);
    } catch {
      return null;
    }
  }, [mode, inputs.poolSize, inputs.hunger, inputs.difficulty, inputs.willpowerDice]);

  const chooseMode = (next: RollMode) => {
    setMode(next);
    history.setError("");
  };

  // The result already exists here; the stage only animates its presentation.
  const roll = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    history.setError("");
    history.setStatus("");
    try {
      const result = rollFor(mode, inputs);
      setLastRoll(result);
      setTrayRoll(canShowTray(result.roll) ? result.roll : null);
      void history.save(result.roll);
    } catch (caught) {
      history.setError(caught instanceof Error ? caught.message : "Não foi possível rolar os dados.");
    }
  };

  const linkedV5 = mode === "v5" && Boolean(selectedSheet);

  return (
    <div className="space-y-4">
      <Panel title="Rolador local" actions={<Tag tone="gold">Somente neste aparelho</Tag>}>
        <p className="mb-4 text-sm text-ink-muted">
          As rolagens usam o gerador seguro do navegador. Nenhum resultado vai para a mesa.
        </p>
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Modo de rolagem">
          {ROLL_MODES.map((item) => (
            <Btn key={item.mode} type="button" variant={mode === item.mode ? "forest" : "outline"} role="tab" aria-selected={mode === item.mode} onClick={() => chooseMode(item.mode)}>
              {item.label}
            </Btn>
          ))}
        </div>

        <form className="space-y-3" onSubmit={roll}>
          {mode === "expression" && <ExpressionFields inputs={inputs} set={set} />}
          {mode === "sotdl" && <SotdlFields inputs={inputs} set={set} />}
          {mode === "hunter" && <HunterFields inputs={inputs} set={set} />}
          {mode === "v5" && (
            <V5Fields inputs={inputs} set={set} sheets={connectedSheets} selectedSheetId={selectedSheetId} onSelectSheet={setSelectedSheetId} contextTag={contextTag} onContextTag={setContextTag} />
          )}
          <label className="block text-sm font-semibold text-ink">
            Rótulo opcional
            <input className="field-input mt-1" value={inputs.label} onChange={(event) => set("label", event.target.value)} maxLength={LABEL_LIMIT} placeholder={mode === "v5" ? "V5 local" : "Ataque, teste…"} />
          </label>
          <Btn type="submit">
            <Dices className="size-4" aria-hidden />
            {linkedV5 ? "Rolar sem condições (local)" : "Rolar"}
          </Btn>
          {linkedV5 && (
            <p className="text-xs text-ink-muted">
              A rolagem local usa a parada informada acima. Ela não aplica as condições calculadas pelo servidor nem registra uma ação na campanha.
            </p>
          )}
        </form>
        {lastRoll && <DiceRollStage roll={lastRoll.roll} context={lastRoll.context} reducedMotion={trayRoll === lastRoll.roll ? true : undefined} />}
        {trayRoll && <DiceTray3D roll={trayRoll} onDone={() => setTrayRoll(null)} />}
        {mode === "v5" && <LocalChances comparison={comparison} />}
        {linkedV5 && <SheetChances pending={Boolean(selectedSheet?.pending)} {...sheetChances} />}
        {history.error && <p className="mt-3 text-sm font-semibold text-destructive" role="alert">{history.error}</p>}
        {history.status && <p className="mt-3 text-sm font-semibold text-ink" role="status" aria-live="polite">{history.status}</p>}
      </Panel>

      <HistoryPanel history={history.history} ready={history.ready} onClear={() => void history.clear()} />
    </div>
  );
}
