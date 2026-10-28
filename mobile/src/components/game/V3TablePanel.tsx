import { useEffect, useState } from "react";
import { Droplet, Dices, HeartPulse, Swords } from "lucide-react";
import type { FieldValue } from "@/lib/sheet-template";
import { v3Derived, v3Traits } from "@/lib/v3-rules";
import {
  V3_QUEUEABLE, clampInt, describeV3Action, describeV3Roll, v3ActionBody, v3EffectivePool, v3RollBody, v3Verdict,
  type V3Action, type V3ActionResult, type V3DamageKind, type V3RollResult,
} from "@/lib/game/table-rules";
import { Btn, Panel } from "@/components/nexus/ui";
import { Check, DiceRow, Field, History, QueueBanner, StatusLine, inputClass, type HistoryItem } from "./TableUi";
import { useOperationIds, type TableApi } from "./useTableApi";

const NONE = "__none__";
type Sheet = { id: string; name: string; values: Record<string, FieldValue> };

/**
 * Vampiro V3 at the table (mobile): the API rolls d10 against difficulty 2-10 with the health
 * penalty, spends Willpower atomically, and applies blood/damage/healing/tests through the v3_* RPCs.
 * Blood, damage and healing wait in the offline queue; tests and rolls need the server.
 */
export function V3TablePanel({ sheet, api }: { sheet: Sheet; api: TableApi }) {
  const values = sheet.values;
  const derived = v3Derived(values);
  const traits = v3Traits(values);
  const ops = useOperationIds();
  const [attributeId, setAttributeId] = useState("");
  const [abilityId, setAbilityId] = useState(NONE);
  const [difficulty, setDifficulty] = useState(6);
  const [specialty, setSpecialty] = useState(false);
  const [willpower, setWillpower] = useState(false);
  const [amount, setAmount] = useState(1);
  const [damageKind, setDamageKind] = useState<V3DamageKind>("letal");
  const [turn, setTurn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" | "queued" }>({ text: "", tone: "info" });
  const [last, setLast] = useState<{ key: string; result: V3RollResult } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    setAttributeId(""); setAbilityId(NONE); setHistory([]); setLast(null); setWillpower(false); setSpecialty(false);
    setMessage({ text: "", tone: "info" }); ops.clear();
  }, [sheet.id, ops]);

  const attribute = traits.attributes.find((trait) => trait.id === attributeId) ?? traits.attributes[0];
  const ability = traits.abilities.find((trait) => trait.id === abilityId);
  const pool = (attribute?.value ?? 0) + (ability?.value ?? 0);
  const willpowerLeft = derived.willpower - derived.willpowerSpent;
  const rolled = v3EffectivePool(pool, derived.penalty);
  const offline = !api.online;

  function push(title: string, text: string) {
    setHistory((current) => [{ id: `${Date.now()}-${current.length}`, title, text, at: new Date().toLocaleTimeString("pt-BR") }, ...current].slice(0, 10));
  }

  async function guard(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage({ text: "", tone: "info" });
    try { await task(); } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Falha na ação.", tone: "error" });
    } finally { setBusy(false); }
  }

  const roll = () => guard(async () => {
    if (!api.request) throw new Error(api.unavailable);
    if (offline) throw new Error("Sem conexão: a rolagem V3 é feita pelo servidor.");
    if (derived.penalty === null) throw new Error("Incapacitado não pode agir.");
    if (willpower && willpowerLeft < 1) throw new Error("Sem Força de Vontade disponível.");
    const key = `roll:${pool}:${difficulty}:${specialty}:${willpower}`;
    const body = v3RollBody({ pool, difficulty, specialty, willpower, damageLevels: derived.marked, sheetId: sheet.id, operationId: ops.take(key) });
    const result = await api.request("POST", "/api/v1/system-rolls/vampire-v3", body) as V3RollResult;
    ops.done(key);
    const title = `${attribute?.label ?? ""}${ability ? ` + ${ability.label}` : ""}`;
    setLast({ key: `${Date.now()}`, result: { ...result, specialty } });
    push(title, describeV3Roll({ ...result, specialty }));
    setMessage({ text: `${v3Verdict(result)}: ${result.successes} sucesso(s).`, tone: "info" });
    if (willpower) { setWillpower(false); api.refreshSheet(); }
  });

  const act = (action: V3Action, title: string, extra: Parameters<typeof v3ActionBody>[1] = {}) => guard(async () => {
    const body = v3ActionBody(action, extra);
    const path = `/api/v1/system-rolls/vampire-v3/sheets/${sheet.id}/actions`;
    if (V3_QUEUEABLE.has(action)) {
      const outcome = await api.adjust({ sheetId: sheet.id, label: `${title} (${sheet.name})`, path, body });
      if (outcome.status === "queued") { setMessage({ text: `${title}: na fila, será enviado ao reconectar.`, tone: "queued" }); return; }
      push(title, describeV3Action(outcome.result as V3ActionResult));
      setMessage({ text: `${title}: aplicado.`, tone: "info" });
      return;
    }
    if (!api.request) throw new Error(api.unavailable);
    if (offline) throw new Error("Sem conexão: testes são rolados pelo servidor.");
    const key = `${action}:${JSON.stringify(body)}`;
    const result = await api.request("POST", path, { ...body, operation_id: ops.take(key) }) as V3ActionResult;
    ops.done(key);
    push(title, describeV3Action(result));
    setMessage({ text: `${title}: ${describeV3Action(result)}`, tone: "info" });
    api.refreshSheet();
  });

  const turnKey = turn.trim() || undefined;
  const idp = `v3-${sheet.id}`;
  return (
    <div className="space-y-4">
      <QueueBanner online={api.online} queued={api.queued} sheetId={sheet.id} onRetry={(id) => void api.retry(id)} onDiscard={(id) => void api.discard(id)} />
      <Panel title="Rolagem V3">
        <p className="mb-3 text-sm text-ink">
          Geração <b>{derived.generation}ª</b> · Sangue <b>{derived.blood}/{derived.bloodMax}</b> (até {derived.perTurn}/turno) ·
          Vontade <b>{willpowerLeft}/{derived.willpower}</b> · Vitalidade <b>{derived.level}</b>{derived.penalty ? ` (${derived.penalty})` : ""} · {derived.path}
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Atributo ou virtude" htmlFor={`${idp}-attr`}>
            <select id={`${idp}-attr`} className={inputClass} value={attribute?.id ?? ""} onChange={(event) => setAttributeId(event.target.value)}>
              {traits.attributes.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}
            </select>
          </Field>
          <Field label="Habilidade ou disciplina" htmlFor={`${idp}-ability`}>
            <select id={`${idp}-ability`} className={inputClass} value={ability?.id ?? NONE} onChange={(event) => setAbilityId(event.target.value)}>
              <option value={NONE}>Nenhuma</option>
              {traits.abilities.map((trait) => <option key={trait.id} value={trait.id}>{trait.label} · {trait.value}</option>)}
            </select>
          </Field>
          <Field label="Dificuldade" htmlFor={`${idp}-diff`} hint="2 a 10">
            <input id={`${idp}-diff`} type="number" inputMode="numeric" min={2} max={10} className={inputClass} value={difficulty}
              onChange={(event) => setDifficulty(clampInt(Number(event.target.value), 2, 10))} />
          </Field>
        </div>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          <Check id={`${idp}-spec`} checked={specialty} onChange={setSpecialty}>Especialização (10 vale dois)</Check>
          <Check id={`${idp}-wp`} checked={willpower} disabled={willpowerLeft < 1} onChange={setWillpower}>Gastar 1 Vontade (+1 sucesso)</Check>
        </div>
        <p className="my-3 text-sm text-ink">Parada: <b>{rolled} dados</b>{derived.penalty ? ` (${pool} ${derived.penalty} de Vitalidade)` : ""}. Cada 1 anula um sucesso; sem sucessos e com um 1 é falha crítica.</p>
        <Btn className="w-full" disabled={busy || !attribute || derived.penalty === null || !api.request || offline} onClick={() => void roll()} aria-busy={busy}>
          <Dices className="size-4" aria-hidden />{busy ? "Rolando…" : offline ? "Rolar (precisa de conexão)" : "Rolar"}
        </Btn>
        {last && <div className="mt-4 space-y-2">
          <DiceRow label="Dados da rolagem V3" rollKey={last.key} dice={last.result.dice.map((face) => ({
            face, label: "d10", tone: face === 1 ? "bad" : face >= last.result.difficulty ? "good" : "normal",
          }))} />
          <p className="text-lg font-bold text-ink">{v3Verdict(last.result)} · {last.result.successes} sucesso(s)</p>
        </div>}
      </Panel>

      <Panel title="Sangue, dano e testes">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Quantidade" htmlFor={`${idp}-amount`}>
            <input id={`${idp}-amount`} type="number" inputMode="numeric" min={1} max={20} className={inputClass} value={amount}
              onChange={(event) => setAmount(clampInt(Number(event.target.value), 1, 20))} />
          </Field>
          <Field label="Tipo de dano" htmlFor={`${idp}-kind`}>
            <select id={`${idp}-kind`} className={inputClass} value={damageKind} onChange={(event) => setDamageKind(event.target.value as V3DamageKind)}>
              <option value="contundente">Contundente (vampiro: metade)</option><option value="letal">Letal</option><option value="agravado">Agravado</option>
            </select>
          </Field>
          <Field label="Turno" htmlFor={`${idp}-turn`} hint="opcional">
            <input id={`${idp}-turn`} className={inputClass} value={turn} maxLength={80} placeholder="combate:rodada" onChange={(event) => setTurn(event.target.value)} />
          </Field>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Btn variant="outline" disabled={busy} onClick={() => void act("sangue", "Gasto de sangue", { amount, turn: turnKey })}><Droplet className="size-4" aria-hidden />Gastar sangue</Btn>
          <Btn variant="outline" disabled={busy} onClick={() => void act("cura", "Cura com sangue", { amount, turn: turnKey })}><HeartPulse className="size-4" aria-hidden />Curar (1 sangue/nível)</Btn>
          <Btn variant="outline" disabled={busy} onClick={() => void act("dano", "Dano", { amount, kind: damageKind })}><Swords className="size-4" aria-hidden />Marcar dano</Btn>
          <Btn variant="outline" disabled={busy || offline || !api.request} onClick={() => void act("sangue_inicial", "Sangue inicial")}>Sangue inicial (1d10)</Btn>
          <Btn variant="outline" disabled={busy || offline || !api.request} onClick={() => void act("frenesi", "Teste de Frenesi", { difficulty })}>Frenesi ({derived.selfControl === "instintos" ? "Instintos" : "Autocontrole"})</Btn>
          <Btn variant="outline" disabled={busy || offline || !api.request} onClick={() => void act("rotschreck", "Rötschreck", { difficulty })}>Rötschreck (Coragem)</Btn>
          <Btn variant="outline" disabled={busy || offline || !api.request} onClick={() => void act("degeneracao", "Degeneração", { difficulty })}>Degeneração ({derived.conscience === "conviccao" ? "Convicção" : "Consciência"})</Btn>
        </div>
        <p className="mt-2 text-xs text-ink-muted">Testes usam a dificuldade acima e são rolados pelo servidor. Sangue, dano e cura ficam na fila quando não há conexão. Regras marcadas para conferência no livro.</p>
      </Panel>

      <StatusLine message={message.text} tone={message.tone} />
      <Panel title="Histórico desta sessão"><History items={history} empty="Nenhuma ação nesta sessão." /></Panel>
    </div>
  );
}
