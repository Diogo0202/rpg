import { useCallback, useEffect, useState } from "react";
import { Dices, RefreshCw } from "lucide-react";
import { clampInt, describeStoredRoll, isStoredRoll, toggleDie, v5OutcomeLabel, type V5StoredRoll } from "@/lib/game/table-rules";
import { Btn, Panel } from "@/components/nexus/ui";
import { DiceRow, Field, History, StatusLine, formatWhen, inputClass } from "./TableUi";
import type { TableApi } from "./useTableApi";

/**
 * V5 stored roll (mobile): POST /api/v1/v5/sheets/{id}/rolls rolls on the server with the sheet's
 * Hunger and modifiers, the remote history comes from GET …/rolls, and the one Willpower reroll of
 * up to 3 ordinary dice goes to /rolls/{id}/willpower-reroll.
 */
export function V5RollPanel({ sheetId, api }: { sheetId: string; api: TableApi }) {
  const request = api.request;
  const [pool, setPool] = useState(5);
  const [difficulty, setDifficulty] = useState(3);
  const [history, setHistory] = useState<V5StoredRoll[]>([]);
  const [current, setCurrent] = useState<V5StoredRoll | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" }>({ text: "", tone: "info" });
  const offline = !api.online;

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    try {
      const rows = await request("GET", `/api/v1/v5/sheets/${sheetId}/rolls?limit=20`);
      setHistory(Array.isArray(rows) ? rows.filter(isStoredRoll) : []);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Não foi possível ler o histórico.", tone: "error" });
    } finally { setLoading(false); }
  }, [request, sheetId]);

  useEffect(() => {
    setCurrent(null); setSelected([]); setHistory([]); setMessage({ text: "", tone: "info" });
    if (api.online) void load();
  }, [sheetId, load, api.online]);

  async function guard(task: (send: NonNullable<typeof request>) => Promise<void>) {
    if (busy) return;
    if (!request) { setMessage({ text: api.unavailable, tone: "error" }); return; }
    if (offline) { setMessage({ text: "Sem conexão: a rolagem V5 guardada é feita pelo servidor.", tone: "error" }); return; }
    setBusy(true); setMessage({ text: "", tone: "info" });
    try { await task(request); } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "A rolagem falhou.", tone: "error" });
    } finally { setBusy(false); }
  }

  const roll = () => guard(async (send) => {
    const result = await send("POST", `/api/v1/v5/sheets/${sheetId}/rolls`, { pool, difficulty, context_tags: [] });
    if (!isStoredRoll(result)) throw new Error("Resposta de rolagem inválida.");
    setCurrent(result); setSelected([]);
    setMessage({ text: describeStoredRoll(result), tone: "info" });
    await load();
  });

  const reroll = () => guard(async (send) => {
    if (!current) return;
    const result = await send("POST", `/api/v1/v5/rolls/${current.id}/willpower-reroll`, { normal_indices: selected }) as { roll?: unknown; willpower_spent?: boolean };
    if (!isStoredRoll(result.roll)) throw new Error("Resposta de rerrolagem inválida.");
    setCurrent(result.roll); setSelected([]);
    setMessage({ text: `${describeStoredRoll(result.roll)}${result.willpower_spent ? " · Vontade marcada" : ""}`, tone: "info" });
    api.refreshSheet();
    await load();
  });

  const idp = `v5roll-${sheetId}`;
  const canReroll = Boolean(current && !current.rerolled_at && current.normal_dice.length);
  return (
    <div className="space-y-4">
      <Panel title="Rolagem guardada V5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Parada" htmlFor={`${idp}-pool`}>
            <input id={`${idp}-pool`} type="number" inputMode="numeric" min={1} max={30} className={inputClass} value={pool} onChange={(event) => setPool(clampInt(Number(event.target.value), 1, 30))} />
          </Field>
          <Field label="Dificuldade" htmlFor={`${idp}-diff`}>
            <input id={`${idp}-diff`} type="number" inputMode="numeric" min={1} max={10} className={inputClass} value={difficulty} onChange={(event) => setDifficulty(clampInt(Number(event.target.value), 1, 10))} />
          </Field>
        </div>
        <p className="my-2 text-xs text-ink-muted">O servidor aplica a Fome e os modificadores da ficha e guarda a rolagem no histórico.</p>
        <Btn className="w-full" disabled={busy || !request || offline} onClick={() => void roll()} aria-busy={busy}>
          <Dices className="size-4" aria-hidden />{busy ? "Rolando…" : offline ? "Rolar (precisa de conexão)" : "Rolar e guardar"}
        </Btn>
      </Panel>

      {current && <Panel title={`${v5OutcomeLabel(current.outcome)} · ${current.outcome.successes}/${current.difficulty}`}>
        <div className="space-y-3">
          <DiceRow label="Dados comuns" rollKey={`${current.id}-${current.normal_dice.join("")}`} selected={selected} disabled={busy}
            onToggle={canReroll ? (index) => setSelected((items) => toggleDie(items, index, 3)) : undefined}
            dice={current.normal_dice.map((face) => ({ face, label: "Dado comum", tone: face === 10 ? "good" : face >= 6 ? "good" : "normal" }))} />
          {current.hunger_dice.length > 0 && <DiceRow label="Dados de Fome" rollKey={`${current.id}-h`}
            dice={current.hunger_dice.map((face) => ({ face, label: "Dado de Fome", tone: face === 1 || face === 10 ? "special" : face >= 6 ? "good" : "bad" }))} />}
          {canReroll && <>
            <p className="text-xs text-ink-muted">Rerrolagem de Vontade: toque em até 3 dados comuns. Só uma vez por rolagem.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Btn variant="outline" disabled={busy || !current.recommended_reroll.length} onClick={() => setSelected(current.recommended_reroll.slice(0, 3))}>
                {current.recommended_reroll.length ? `Sugestão: dados ${current.recommended_reroll.map((item) => item + 1).join(", ")}` : "Rerrolar não melhora"}
              </Btn>
              <Btn disabled={busy || !selected.length || offline} onClick={() => void reroll()}>Rerrolar {selected.length} com Vontade</Btn>
            </div>
          </>}
        </div>
      </Panel>}

      <StatusLine message={message.text} tone={message.tone} />
      <Panel title="Histórico remoto" actions={<Btn size="sm" variant="ghost" disabled={loading || offline || !request} onClick={() => void load()} aria-label="Recarregar histórico"><RefreshCw className="size-4" aria-hidden />{loading ? "Lendo…" : "Atualizar"}</Btn>}>
        <History empty={offline ? "Sem conexão: o histórico aparece ao reconectar." : "Nenhuma rolagem guardada."} items={history.map((roll) => ({
          id: roll.id, title: `${roll.pool} dados · Fome ${roll.hunger}`, at: formatWhen(roll.created_at),
          text: `${describeStoredRoll(roll)} · comuns ${roll.normal_dice.join(" · ") || "—"} · Fome ${roll.hunger_dice.join(" · ") || "—"}`,
        }))} />
      </Panel>
    </div>
  );
}
