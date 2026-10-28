import { useCallback, useEffect, useState } from "react";
import { Dices, RefreshCw } from "lucide-react";
import type { FieldValue } from "@/lib/sheet-template";
import { HUNTER_SKILLS } from "@/lib/hunter-creation-data";
import { inDespair, usableEdges } from "@/lib/hunter-traits";
import {
  HUNTER_ATTRIBUTES, HUNTER_CHOICE_LABEL, cellAdjustBody, clampInt, describeHunterRoll, hunterRollBody, int, isHunterRoll, toggleDie,
  type HunterChoice, type HunterRoll, type HunterState,
} from "@/lib/game/table-rules";
import { Btn, Panel } from "@/components/nexus/ui";
import { Check, DiceRow, Field, History, QueueBanner, StatusLine, inputClass, type HistoryItem } from "./TableUi";
import type { TableApi } from "./useTableApi";

const NONE = "__none__";
type Sheet = { id: string; name: string; values: Record<string, FieldValue> };
type Trait = { id: string; label: string; value: number };

function traitsOf(list: Array<[string, string]>, values: Record<string, FieldValue>): Trait[] {
  return list.flatMap(([id, label]) => (typeof values[id] === "number" ? [{ id, label, value: int(values[id]) }] : []));
}

/**
 * Caçador at the table (mobile), same routes as the web: the server reads the cell's Desperation,
 * rolls and stores the dice; the table resolves Overreach/Despair, the one Willpower reroll of up to
 * 3 ordinary dice, Despair blocks Desperation dice and Edges, and Redemption waits for the narrator.
 * Cell Danger/Desperation steps (narrator) wait in the offline queue.
 */
export function HunterTablePanel({ sheet, api }: { sheet: Sheet; api: TableApi }) {
  const values = sheet.values;
  const attributes = traitsOf(HUNTER_ATTRIBUTES, values);
  const skills = traitsOf(HUNTER_SKILLS, values);
  const [state, setState] = useState<HunterState | null>(null);
  const [stateError, setStateError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attributeId, setAttributeId] = useState("");
  const [skillId, setSkillId] = useState(NONE);
  const [difficulty, setDifficulty] = useState(3);
  const [useDesperation, setUseDesperation] = useState(false);
  const [edge, setEdge] = useState("");
  const [latest, setLatest] = useState<HunterRoll | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" | "queued" }>({ text: "", tone: "info" });
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const request = api.request;

  const loadState = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    try {
      setState(await request("GET", `/api/v1/hunter/sheets/${sheet.id}/state`) as HunterState);
      setStateError("");
    } catch (error) {
      setStateError(error instanceof Error ? error.message : "Não foi possível ler a célula.");
    } finally { setLoading(false); }
  }, [request, sheet.id]);

  useEffect(() => {
    setLatest(null); setSelected([]); setHistory([]); setAttributeId(""); setSkillId(NONE); setEdge(""); setUseDesperation(false); setNote("");
    setMessage({ text: "", tone: "info" });
    if (api.online) void loadState();
  }, [sheet.id, loadState, api.online]);

  const despair = state?.in_despair ?? inDespair(values);
  const edges = usableEdges(values);
  const attribute = attributes.find((trait) => trait.id === attributeId) ?? attributes[0];
  const skill = skills.find((trait) => trait.id === skillId);
  const basePool = (attribute?.value ?? 0) + (skill?.value ?? 0);
  const desperationDice = state?.cell?.desperation ?? 0;
  const offline = !api.online;

  function push(title: string, roll: HunterRoll) {
    setHistory((current) => [{ id: `${roll.roll_id}-${Date.now()}`, title, text: describeHunterRoll(roll), at: new Date().toLocaleTimeString("pt-BR") }, ...current].slice(0, 10));
  }

  async function guard(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage({ text: "", tone: "info" });
    try { await task(); } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "A ação falhou.", tone: "error" });
    } finally { setBusy(false); }
  }

  function online(): NonNullable<typeof request> {
    if (!request) throw new Error(api.unavailable);
    if (offline) throw new Error("Sem conexão: rolagens do Caçador são feitas pelo servidor.");
    return request;
  }

  const roll = () => guard(async () => {
    const send = online();
    const body = hunterRollBody({ basePool, difficulty, useDesperation, edge, despair });
    const result = await send("POST", `/api/v1/hunter/sheets/${sheet.id}/rolls`, body);
    if (!isHunterRoll(result)) throw new Error("Resposta de rolagem inválida.");
    setLatest(result); setSelected([]);
    push(`${attribute?.label ?? ""}${skill ? ` + ${skill.label}` : ""}`, result);
    setMessage({ text: `${result.verdict}: ${result.successes}/${result.difficulty} sucessos.`, tone: "info" });
    if (result.cell !== undefined) void loadState();
  });

  const reroll = () => guard(async () => {
    if (!latest) return;
    const result = await online()("POST", `/api/v1/hunter/rolls/${latest.roll_id}/reroll`, { indices: selected });
    if (!isHunterRoll(result)) throw new Error("Resposta de rolagem inválida.");
    setLatest(result); setSelected([]);
    push("Rerrolagem com Vontade", result);
    api.refreshSheet();
  });

  const resolve = (choice: HunterChoice) => guard(async () => {
    if (!latest) return;
    const result = await online()("POST", `/api/v1/hunter/rolls/${latest.roll_id}/resolve`, { choice });
    if (!isHunterRoll(result)) throw new Error("Resposta de rolagem inválida.");
    setLatest(result);
    push(choice === "overreach" ? "Overreach" : "Despair", result);
    api.refreshSheet();
    await loadState();
  });

  const requestRedemption = () => guard(async () => {
    await online()("POST", `/api/v1/hunter/sheets/${sheet.id}/redemption`, { note: note.trim().slice(0, 500) });
    setNote("");
    setMessage({ text: "Redenção registrada; o narrador decide.", tone: "info" });
    await loadState();
  });

  const decide = (approve: boolean) => guard(async () => {
    const id = state?.pending_redemption?.id;
    if (!id) return;
    await online()("POST", `/api/v1/hunter/redemptions/${id}/decision`, { approve, note: "" });
    setMessage({ text: approve ? "Redenção aprovada: o Desespero terminou." : "Redenção recusada.", tone: "info" });
    api.refreshSheet();
    await loadState();
  });

  const adjustCell = (danger: number, desperation: number) => guard(async () => {
    const cell = state?.cell;
    if (!cell) return;
    const label = danger ? `Perigo ${danger > 0 ? "+1" : "−1"}` : `Desesperação ${desperation > 0 ? "+1" : "−1"}`;
    const outcome = await api.adjust({ sheetId: sheet.id, label: `Célula ${cell.name}: ${label}`, path: `/api/v1/hunter/cells/${cell.id}/adjust`, body: cellAdjustBody(danger, desperation) });
    // Local preview so the narrator sees the step even before the reply.
    setState((current) => current?.cell ? { ...current, cell: { ...current.cell, danger: clampInt(current.cell.danger + danger, 0, 5), desperation: clampInt(current.cell.desperation + desperation, 0, 5) } } : current);
    if (outcome.status === "queued") setMessage({ text: `${label}: na fila, será enviado ao reconectar.`, tone: "queued" });
    else { setMessage({ text: `${label} aplicado.`, tone: "info" }); await loadState(); }
  });

  const idp = `hunter-${sheet.id}`;
  const cell = state?.cell;
  return (
    <div className="space-y-4">
      <QueueBanner online={api.online} queued={api.queued} sheetId={sheet.id} onRetry={(id) => void api.retry(id)} onDiscard={(id) => void api.discard(id)} />
      <Panel title="Célula" actions={<Btn size="sm" variant="ghost" disabled={loading || offline || !request} onClick={() => void loadState()} aria-label="Recarregar célula"><RefreshCw className="size-4" aria-hidden />{loading ? "Lendo…" : "Atualizar"}</Btn>}>
        {stateError && <StatusLine message={stateError} tone="error" />}
        <p className="text-sm text-ink" aria-live="polite">{cell
          ? <>Célula <b>{cell.name}</b>: Desesperação <b>{cell.desperation}</b> · Perigo <b>{cell.danger}</b>{despair ? " · em Desespero" : ""}</>
          : loading ? "Lendo a célula…" : "Ficha sem célula vinculada: o narrador inclui a ficha numa célula."}</p>
        {cell && api.narrator && <div className="mt-3 grid grid-cols-2 gap-2">
          <Btn variant="outline" size="sm" disabled={busy || cell.danger <= 0} onClick={() => void adjustCell(-1, 0)}>Perigo −1</Btn>
          <Btn variant="outline" size="sm" disabled={busy || cell.danger >= 5} onClick={() => void adjustCell(1, 0)}>Perigo +1</Btn>
          <Btn variant="outline" size="sm" disabled={busy || cell.desperation <= 0} onClick={() => void adjustCell(0, -1)}>Desesperação −1</Btn>
          <Btn variant="outline" size="sm" disabled={busy || cell.desperation >= 5} onClick={() => void adjustCell(0, 1)}>Desesperação +1</Btn>
        </div>}
      </Panel>

      <Panel title="Rolagem do Caçador">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Atributo" htmlFor={`${idp}-attr`}>
            <select id={`${idp}-attr`} className={inputClass} value={attribute?.id ?? ""} onChange={(event) => setAttributeId(event.target.value)}>
              {attributes.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}
            </select>
          </Field>
          <Field label="Habilidade" htmlFor={`${idp}-skill`}>
            <select id={`${idp}-skill`} className={inputClass} value={skill?.id ?? NONE} onChange={(event) => setSkillId(event.target.value)}>
              <option value={NONE}>Sem habilidade</option>
              {skills.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}
            </select>
          </Field>
          <Field label="Dificuldade" htmlFor={`${idp}-diff`}>
            <input id={`${idp}-diff`} type="number" inputMode="numeric" min={1} max={10} className={inputClass} value={difficulty}
              onChange={(event) => setDifficulty(clampInt(Number(event.target.value), 1, 10))} />
          </Field>
        </div>
        <Check id={`${idp}-desp`} checked={useDesperation && !despair} disabled={despair || !desperationDice} onChange={setUseDesperation}>
          Somar {desperationDice} dado(s) de Desesperação{despair ? " (bloqueado em Desespero)" : ""}
        </Check>
        <Field label="Triunfo usado" htmlFor={`${idp}-edge`} hint={despair ? "bloqueado em Desespero" : undefined}>
          <select id={`${idp}-edge`} className={inputClass} value={despair ? "" : edge} disabled={despair || !edges.length} onChange={(event) => setEdge(event.target.value)}>
            <option value="">Nenhum</option>
            {edges.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </Field>
        <p className="my-3 text-sm text-ink">Reserva base: <b>{basePool} dados</b>{useDesperation && !despair && desperationDice ? ` + ${desperationDice} de Desesperação` : ""}.</p>
        <Btn className="w-full" disabled={busy || basePool < 1 || !request || offline} onClick={() => void roll()} aria-busy={busy}>
          <Dices className="size-4" aria-hidden />{busy ? "Rolando…" : offline ? "Rolar (precisa de conexão)" : "Rolar"}
        </Btn>
      </Panel>

      {latest && <Panel title={`${latest.verdict} · ${latest.successes}/${latest.difficulty}`}>
        <div className="space-y-3">
          <DiceRow label="Dados comuns" rollKey={`${latest.roll_id}-${latest.normal_dice.join("")}`} selected={selected}
            onToggle={latest.can_reroll ? (index) => setSelected((current) => toggleDie(current, index, 3)) : undefined} disabled={busy}
            dice={latest.normal_dice.map((face) => ({ face, label: "Dado comum", tone: face >= 6 ? "good" : "normal" }))} />
          {latest.desperation_dice.length > 0 && <DiceRow label="Dados de Desesperação" rollKey={`${latest.roll_id}-d`}
            dice={latest.desperation_dice.map((face) => ({ face, label: "Dado de Desesperação", tone: face === 1 ? "special" : face >= 6 ? "good" : "normal" }))} />}
          <p className="text-sm text-ink">{describeHunterRoll(latest)}</p>
          {latest.choices.length > 0 && <div className="grid gap-2" role="group" aria-label="Escolha da mesa">
            {latest.choices.map((choice) => <Btn key={choice} variant={choice === "despair" ? "danger" : "gold"} disabled={busy} onClick={() => void resolve(choice)}>{HUNTER_CHOICE_LABEL[choice]}</Btn>)}
          </div>}
          {latest.can_reroll && <>
            <p className="text-xs text-ink-muted">Rerrolagem de Vontade: toque em até 3 dados comuns; uma vez por teste, gasta 1 de Vontade.</p>
            <Btn variant="outline" className="w-full" disabled={busy || !selected.length || offline} onClick={() => void reroll()}>Rerrolar {selected.length} dado(s) com Vontade</Btn>
          </>}
        </div>
      </Panel>}

      <Panel title="Desespero e Redenção">
        <p className="text-sm text-ink">{despair ? "Em Desespero: sem dados de Desesperação e Triunfos bloqueados." : "Fora do Desespero."} Ímpeto <b>{String(values.impulso ?? "—")}</b>.</p>
        {despair && !state?.pending_redemption && <div className="mt-3 space-y-2">
          <Field label="Como o Ímpeto foi cumprido" htmlFor={`${idp}-note`}>
            <textarea id={`${idp}-note`} className="field-input min-h-24 w-full" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <Btn variant="outline" className="w-full" disabled={busy || offline || !request} onClick={() => void requestRedemption()}>Registrar Redenção</Btn>
        </div>}
        {state?.pending_redemption && <div className="mt-3 space-y-2">
          <p className="text-sm text-ink">Redenção pendente ({state.pending_redemption.drive}): {state.pending_redemption.note || "sem nota"}.</p>
          {api.narrator && <div className="grid gap-2 sm:grid-cols-2">
            <Btn disabled={busy || offline} onClick={() => void decide(true)}>Aprovar e encerrar o Desespero</Btn>
            <Btn variant="outline" disabled={busy || offline} onClick={() => void decide(false)}>Recusar</Btn>
          </div>}
        </div>}
      </Panel>

      <StatusLine message={message.text} tone={message.tone} />
      <Panel title="Histórico desta sessão"><History items={history} empty="Nenhuma rolagem nesta sessão." /></Panel>
    </div>
  );
}
