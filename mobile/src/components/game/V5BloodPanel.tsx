import { useCallback, useEffect, useState } from "react";
import { Droplets, RefreshCw } from "lucide-react";
import type { FieldValue } from "@/lib/sheet-template";
import { describeV5Power, v5PowerMetadata } from "@/lib/v5-creation-data";
import {
  BLOOD_KIND_LABELS, COMPULSION_OPTIONS, bloodQueueable, FRENZY_LABELS, clampInt, describeBloodEvent,
  type BloodEvent, type BloodResponse, type BloodState, type FrenzyKind,
} from "@/lib/game/table-rules";
import { Btn, Panel } from "@/components/nexus/ui";
import { DiceRow, Field, History, StatusLine, formatWhen, inputClass } from "./TableUi";
import { useOperationIds, type TableApi } from "./useTableApi";

type Sheet = { id: string; name: string; values: Record<string, FieldValue> };

/**
 * V5 Blood cycle (mobile): Rouse, Awaken, Remorse, Frenzy, Compulsion and Torpor through
 * /api/v1/v5/sheets/{id}/…; the database rolls and writes atomically. Potency derivatives come
 * from GET /blood. Compulsion and Torpor (no dice) wait in the offline queue.
 */
export function V5BloodPanel({ sheet, api }: { sheet: Sheet; api: TableApi }) {
  const ops = useOperationIds();
  const request = api.request;
  const [state, setState] = useState<BloodState | null>(null);
  const [events, setEvents] = useState<BloodEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" | "queued" }>({ text: "", tone: "info" });
  const [power, setPower] = useState("");
  const [frenzyKind, setFrenzyKind] = useState<FrenzyKind>("fury");
  const [frenzyDifficulty, setFrenzyDifficulty] = useState(3);
  const [compulsion, setCompulsion] = useState("");
  const [lastDice, setLastDice] = useState<{ key: string; dice: number[] } | null>(null);

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    try {
      const [blood, rows] = await Promise.all([
        request("GET", `/api/v1/v5/sheets/${sheet.id}/blood`),
        request("GET", `/api/v1/v5/sheets/${sheet.id}/blood-events?limit=20`).catch(() => []),
      ]);
      setState(blood as BloodState);
      setEvents(Array.isArray(rows) ? rows as BloodEvent[] : []);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Não foi possível ler o Sangue.", tone: "error" });
    } finally { setLoading(false); }
  }, [request, sheet.id]);

  useEffect(() => {
    setState(null); setEvents([]); setPower(""); setLastDice(null); setMessage({ text: "", tone: "info" }); ops.clear();
    if (api.online) void load();
  }, [sheet.id, load, api.online, ops]);

  const powers = (Array.isArray(sheet.values.disciplinas) ? sheet.values.disciplinas : [])
    .filter((item): item is string => typeof item === "string")
    .map((item) => ({ item, meta: v5PowerMetadata(item) }));
  const chosen = powers.find((entry) => entry.item === power)?.meta ?? null;
  const offline = !api.online;

  async function act(kind: string, body: Record<string, unknown>) {
    const queueable = bloodQueueable(kind, body);
    if (busy) return;
    setBusy(true); setMessage({ text: "", tone: "info" });
    const path = `/api/v1/v5/sheets/${sheet.id}/${kind}`;
    try {
      if (queueable) {
        const outcome = await api.adjust({ sheetId: sheet.id, label: `${BLOOD_KIND_LABELS[kind]} (${sheet.name})`, path, body });
        if (outcome.status === "queued") { setMessage({ text: `${BLOOD_KIND_LABELS[kind]}: na fila, será enviado ao reconectar.`, tone: "queued" }); return; }
        const result = outcome.result as BloodResponse;
        if (result?.state) setState(result.state);
        setMessage({ text: `${BLOOD_KIND_LABELS[kind]}: ${describeBloodEvent({ kind, outcome: result?.outcome ?? {} })}.`, tone: "info" });
        await load();
        return;
      }
      if (!request) throw new Error(api.unavailable);
      if (offline) throw new Error("Sem conexão: este teste é rolado pelo servidor.");
      // A retry after a lost reply reuses the same operation ID, so the database never rolls twice.
      const key = `${kind}:${JSON.stringify(body)}`;
      const result = await request("POST", path, { ...body, operation_id: ops.take(key) }) as BloodResponse;
      ops.done(key);
      if (result.state) setState(result.state);
      setLastDice({ key: `${Date.now()}`, dice: result.dice ?? [] });
      setMessage({ text: `${result.replayed ? "Já registrado: " : ""}${BLOOD_KIND_LABELS[kind]}: ${describeBloodEvent({ kind, outcome: result.outcome })}.`, tone: "info" });
      api.refreshSheet();
      await load();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Falha na ação de Sangue.", tone: "error" });
    } finally { setBusy(false); }
  }

  const idp = `blood-${sheet.id}`;
  const disabled = busy || !request;
  const potency = state?.potency;
  return (
    <div className="space-y-4">
      <Panel title={`Potência de Sangue ${potency?.potency ?? "—"}`} actions={<Btn size="sm" variant="ghost" disabled={loading || offline || !request} onClick={() => void load()} aria-label="Recarregar Sangue"><RefreshCw className="size-4" aria-hidden />{loading ? "Lendo…" : "Atualizar"}</Btn>}>
        {state && potency ? <div className="space-y-1 text-sm text-ink">
          <p>Surto <b>+{potency.surge} dados</b> · Remendar <b>{potency.mend}</b> · Bônus de Poder <b>+{potency.power_bonus}</b></p>
          <p>Rerrolagem de Rouse <b>{potency.rouse_reroll_level ? `poderes até nível ${potency.rouse_reroll_level}` : "nenhuma"}</b> · Severidade da Perdição <b>{potency.bane_severity}</b></p>
          <p>Fome <b>{state.hunger}/5</b> · Humanidade <b>{state.humanity}</b> · Manchas <b>{state.stains}</b> · Vontade <b>{state.willpower_current}</b>{state.in_torpor ? <> · <b>Em Torpor</b></> : null}</p>
        </div> : <p className="text-sm text-ink-muted" aria-live="polite">{loading ? "Lendo o Sangue…" : offline ? "Sem conexão: o estado do Sangue aparece ao reconectar." : "Estado do Sangue indisponível."}</p>}
      </Panel>

      <Panel title="Rouse e Despertar">
        <Field label="Poder de Disciplina" htmlFor={`${idp}-power`} hint="opcional">
          <select id={`${idp}-power`} className={inputClass} value={power} onChange={(event) => setPower(event.target.value)}>
            <option value="">Sem poder (Surto, Remendar ou outro)</option>
            {powers.map((entry) => <option key={entry.item} value={entry.item}>{entry.item}{entry.meta ? ` · ${describeV5Power(entry.meta)}` : ""}</option>)}
          </select>
        </Field>
        {state && <p className="mt-2 text-xs text-ink-muted">Chance de não aumentar a Fome: {Math.round(state.rouse_success * 100)}%{chosen && potency && chosen.level <= potency.rouse_reroll_level ? " (rerrolagem pela Potência)" : ""}.</p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Btn disabled={disabled || offline} onClick={() => void act("rouse", { discipline_level: chosen?.level ?? null, reason: power ? power.slice(0, 120) : null })}><Droplets className="size-4" aria-hidden />Rouse Check</Btn>
          <Btn variant="outline" disabled={disabled || offline || state?.in_torpor} onClick={() => void act("awaken", {})}>Despertar ao anoitecer</Btn>
        </div>
        {state?.hunger === 5 && <p className="mt-2 text-sm font-semibold text-destructive">Fome 5: um Rouse que falhar pede teste de frenesi de fome.</p>}
      </Panel>

      <Panel title="Remorso e Frenesi">
        <p className="text-sm text-ink">Remorso: <b>{state?.stains ? `${state.remorse_pool} dado(s) · ${Math.round((state.remorse_success ?? 0) * 100)}% de manter a Humanidade` : "sem Manchas"}</b></p>
        <Btn variant="outline" className="mt-2 w-full" disabled={disabled || offline || !state?.stains} onClick={() => void act("remorse", {})}>Teste de Remorso</Btn>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Tipo de frenesi" htmlFor={`${idp}-fkind`}>
            <select id={`${idp}-fkind`} className={inputClass} value={frenzyKind} onChange={(event) => setFrenzyKind(event.target.value as FrenzyKind)}>
              {(Object.keys(FRENZY_LABELS) as FrenzyKind[]).map((kind) => <option key={kind} value={kind}>{FRENZY_LABELS[kind]}</option>)}
            </select>
          </Field>
          <Field label="Dificuldade" htmlFor={`${idp}-fdiff`}>
            <input id={`${idp}-fdiff`} type="number" inputMode="numeric" min={1} max={10} className={inputClass} value={frenzyDifficulty}
              onChange={(event) => setFrenzyDifficulty(clampInt(Number(event.target.value), 1, 10))} />
          </Field>
        </div>
        <Btn variant="outline" className="mt-2 w-full" disabled={disabled || offline} onClick={() => void act("frenzy", { difficulty: frenzyDifficulty, kind: frenzyKind })}>
          Resistir{state ? ` (${state.frenzy_pool[frenzyKind]} dados)` : ""}
        </Btn>
      </Panel>

      <Panel title="Compulsão e Torpor">
        <p className="text-sm text-ink">Compulsão atual: <b>{state?.compulsion ?? "Nenhuma"}</b>{state?.compulsion_detail ? ` · ${state.compulsion_detail.name}: ${state.compulsion_detail.effect}` : ""}</p>
        {state?.clan_compulsion && <p className="text-xs text-ink-muted">Do clã: {state.clan_compulsion.name} ({state.clan_compulsion.effect}).</p>}
        <Field label="Compulsão" htmlFor={`${idp}-comp`} hint="sortear precisa de conexão">
          <select id={`${idp}-comp`} className={inputClass} value={compulsion} onChange={(event) => setCompulsion(event.target.value)}>
            <option value="">Sortear no d10</option>
            {COMPULSION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Btn variant="outline" disabled={busy || (!compulsion && (offline || !request))} onClick={() => void act("compulsion", { compulsion: compulsion || null })}>Registrar compulsão</Btn>
          <Btn variant="outline" disabled={busy} onClick={() => void act("torpor", { in_torpor: !state?.in_torpor })}>{state?.in_torpor ? "Sair do Torpor" : "Entrar em Torpor"}</Btn>
        </div>
        {state && <p className="mt-2 text-xs text-ink-muted">Duração do Torpor com Humanidade {state.humanity}: {state.torpor_duration}.</p>}
      </Panel>

      {lastDice && lastDice.dice.length > 0 && <DiceRow label="Dados da última ação de Sangue" rollKey={lastDice.key} dice={lastDice.dice.map((face) => ({ face, label: "d10", tone: face >= 6 ? "good" : face === 1 ? "bad" : "normal" }))} />}
      <StatusLine message={message.text} tone={message.tone} />
      <Panel title="Histórico do Sangue">
        <History empty="Nenhuma ação de Sangue registrada." items={events.map((event) => ({
          id: String(event.id), title: BLOOD_KIND_LABELS[event.kind] ?? event.kind, at: formatWhen(event.created_at),
          text: `${describeBloodEvent(event)}${event.dice?.length ? ` · dados ${event.dice.join(" · ")}` : ""}`,
        }))} />
      </Panel>
    </div>
  );
}
