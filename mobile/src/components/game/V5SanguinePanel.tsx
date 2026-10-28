import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  V5_INTENSITIES, V5_RESONANCES, bondDegreeLabel, clampInt, huntBody, isStoredRoll,
  type BloodBond, type Hunt, type RegnantAction, type V5StoredRoll,
} from "@/lib/game/table-rules";
import { Btn, Panel } from "@/components/nexus/ui";
import { Check, Field, History, StatusLine, formatWhen, inputClass } from "./TableUi";
import type { TableApi } from "./useTableApi";

type Option = { id: string; name: string };

/**
 * V5 hunt, Blood Bond and actions against the Regnant (mobile), same routes as the web
 * (backend/app/routes/v5_sanguine.py). The hunt and the bond drink carry an operation_id and
 * wait in the offline queue; reading and the Regnant flow need the server.
 */
export function V5SanguinePanel({ sheetId, sheetName, api, donors }: { sheetId: string; sheetName: string; api: TableApi; donors: Option[] }) {
  const request = api.request;
  const offline = !api.online;
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [bonds, setBonds] = useState<BloodBond[]>([]);
  const [actions, setActions] = useState<RegnantAction[]>([]);
  const [rolls, setRolls] = useState<V5StoredRoll[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" | "queued" }>({ text: "", tone: "info" });
  const [prey, setPrey] = useState("");
  const [resonance, setResonance] = useState<string>("Nenhuma");
  const [intensity, setIntensity] = useState<string>("Nenhuma");
  const [dyscrasia, setDyscrasia] = useState("");
  const [slake, setSlake] = useState(1);
  const [killed, setKilled] = useState(false);
  const [donorId, setDonorId] = useState("");
  const [drinkNotes, setDrinkNotes] = useState("");
  const [bondId, setBondId] = useState("");
  const [actionText, setActionText] = useState("");
  const [rollId, setRollId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    const base = `/api/v1/v5/sheets/${sheetId}`;
    const list = async <T,>(path: string): Promise<T[]> => { const rows = await request("GET", path); return Array.isArray(rows) ? rows as T[] : []; };
    try {
      const [h, b, a, r] = await Promise.all([
        list<Hunt>(`${base}/hunts?limit=10`), list<BloodBond>(`${base}/blood-bonds`), list<RegnantAction>(`${base}/regnant-actions`),
        list<unknown>(`${base}/rolls?limit=10`).catch(() => []),
      ]);
      setHunts(h); setBonds(b); setActions(a); setRolls((r as unknown[]).filter((item): item is V5StoredRoll => isStoredRoll(item)));
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Não foi possível ler caçadas e vínculos.", tone: "error" });
    } finally { setLoading(false); }
  }, [request, sheetId]);

  useEffect(() => {
    setHunts([]); setBonds([]); setActions([]); setRolls([]); setMessage({ text: "", tone: "info" });
    if (api.online) void load();
  }, [sheetId, load, api.online]);

  async function guard(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setMessage({ text: "", tone: "info" });
    try { await task(); } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "A ação falhou.", tone: "error" });
    } finally { setBusy(false); }
  }

  const hunt = () => guard(async () => {
    const built = huntBody({ prey, resonance, intensity, dyscrasia, slake, killed });
    if ("error" in built) throw new Error(built.error);
    const outcome = await api.adjust({ sheetId, label: `Caçada: ${built.body.prey as string} (${sheetName})`, path: `/api/v1/v5/sheets/${sheetId}/hunts`, body: built.body });
    setPrey(""); setDyscrasia(""); setKilled(false);
    if (outcome.status === "queued") setMessage({ text: "Caçada na fila: será registrada ao reconectar.", tone: "queued" });
    else { setMessage({ text: "Caçada registrada: Fome e Ressonância atualizadas.", tone: "info" }); await load(); }
  });

  const drink = () => guard(async () => {
    if (!donorId) throw new Error("Escolha o doador.");
    const body = { regnant_sheet_id: donorId, notes: drinkNotes.trim() ? drinkNotes.trim().slice(0, 300) : null };
    const outcome = await api.adjust({ sheetId, label: `Ingestão do Vínculo (${sheetName})`, path: `/api/v1/v5/sheets/${sheetId}/blood-bonds/drinks`, body });
    setDrinkNotes("");
    if (outcome.status === "queued") setMessage({ text: "Ingestão na fila: será registrada ao reconectar.", tone: "queued" });
    else { setMessage({ text: "Ingestão registrada.", tone: "info" }); await load(); }
  });

  const requestAction = () => guard(async () => {
    if (!request) throw new Error(api.unavailable);
    if (offline) throw new Error("Sem conexão: ações contra o Regente precisam do servidor.");
    if (!bondId || !actionText.trim()) throw new Error("Escolha o vínculo e descreva a ação.");
    await request("POST", `/api/v1/v5/blood-bonds/${bondId}/regnant-actions`, { action: actionText.trim().slice(0, 300), roll_id: rollId || null });
    setActionText(""); setRollId("");
    setMessage({ text: "Ação registrada; o narrador decide.", tone: "info" });
    await load();
  });

  const decide = (action: RegnantAction, decision: "permitida" | "negada") => guard(async () => {
    if (!request) throw new Error(api.unavailable);
    if (offline) throw new Error("Sem conexão: a decisão precisa do servidor.");
    await request("POST", `/api/v1/v5/regnant-actions/${action.id}/decision`, { decision, note: notes[action.id]?.trim() || null });
    setMessage({ text: decision === "permitida" ? "Ação permitida." : "Ação negada.", tone: "info" });
    await load();
  });

  const idp = `san-${sheetId}`;
  const otherDonors = donors.filter((donor) => donor.id !== sheetId);
  return (
    <div className="space-y-4">
      <Panel title="Caçada" actions={<Btn size="sm" variant="ghost" disabled={loading || offline || !request} onClick={() => void load()} aria-label="Recarregar caçadas e vínculos"><RefreshCw className="size-4" aria-hidden />{loading ? "Lendo…" : "Atualizar"}</Btn>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Presa" htmlFor={`${idp}-prey`}><input id={`${idp}-prey`} className={inputClass} value={prey} maxLength={120} onChange={(event) => setPrey(event.target.value)} /></Field>
          <Field label="Saciar (Fome a reduzir)" htmlFor={`${idp}-slake`}><input id={`${idp}-slake`} type="number" inputMode="numeric" min={0} max={5} className={inputClass} value={slake} onChange={(event) => setSlake(clampInt(Number(event.target.value), 0, 5))} /></Field>
          <Field label="Ressonância" htmlFor={`${idp}-res`}>
            <select id={`${idp}-res`} className={inputClass} value={resonance} onChange={(event) => { setResonance(event.target.value); if (event.target.value === "Nenhuma") setIntensity("Nenhuma"); else if (intensity === "Nenhuma") setIntensity("Fugaz"); }}>
              {V5_RESONANCES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          <Field label="Intensidade" htmlFor={`${idp}-int`}>
            <select id={`${idp}-int`} className={inputClass} value={intensity} onChange={(event) => setIntensity(event.target.value)}>
              {V5_INTENSITIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
          {intensity === "Aguda" && <Field label="Discrasia" htmlFor={`${idp}-dys`} hint="opcional"><input id={`${idp}-dys`} className={inputClass} value={dyscrasia} maxLength={160} onChange={(event) => setDyscrasia(event.target.value)} /></Field>}
        </div>
        <Check id={`${idp}-killed`} checked={killed} onChange={setKilled}>A presa morreu</Check>
        <Btn className="mt-2 w-full" disabled={busy || !prey.trim()} onClick={() => void hunt()}>Registrar caçada</Btn>
        <div className="mt-3"><History empty={offline ? "Sem conexão: o histórico aparece ao reconectar." : "Nenhuma caçada registrada."} items={hunts.map((item) => ({
          id: item.id, title: item.prey, at: formatWhen(item.created_at),
          text: `Fome ${item.hunger_before} → ${item.hunger_after} · ${item.resonance}${item.intensity !== "Nenhuma" ? ` (${item.intensity})` : ""}${item.dyscrasia ? ` · ${item.dyscrasia}` : ""}${item.killed ? " · morta" : ""}`,
        }))} /></div>
      </Panel>

      <Panel title="Vínculos de Sangue">
        {bonds.length === 0 ? <p className="text-sm text-ink-muted">Nenhum vínculo registrado.</p> : <ul className="space-y-2">
          {bonds.map((bond) => <li key={bond.id} className="parchment-inset p-3 text-sm text-ink">
            <b>{bond.regnant_label ?? "Regente"}</b> · {bondDegreeLabel(bond.degree)} · {bond.drinks.length} ingestão(ões) · enfraquece em {bond.decay_days} dia(s)
          </li>)}
        </ul>}
        {api.narrator && <div className="mt-3 space-y-2">
          <Field label="Doador (ficha da campanha)" htmlFor={`${idp}-donor`}>
            <select id={`${idp}-donor`} className={inputClass} value={donorId} onChange={(event) => setDonorId(event.target.value)}>
              <option value="">Escolha</option>
              {otherDonors.map((donor) => <option key={donor.id} value={donor.id}>{donor.name}</option>)}
            </select>
          </Field>
          <Field label="Notas" htmlFor={`${idp}-dnotes`} hint="opcional"><input id={`${idp}-dnotes`} className={inputClass} value={drinkNotes} maxLength={300} onChange={(event) => setDrinkNotes(event.target.value)} /></Field>
          <Btn variant="outline" className="w-full" disabled={busy || !donorId} onClick={() => void drink()}>Registrar ingestão</Btn>
        </div>}
      </Panel>

      <Panel title="Ações contra o Regente">
        {bonds.length > 0 && <div className="space-y-2">
          <Field label="Vínculo" htmlFor={`${idp}-bond`}>
            <select id={`${idp}-bond`} className={inputClass} value={bondId} onChange={(event) => setBondId(event.target.value)}>
              <option value="">Escolha</option>
              {bonds.map((bond) => <option key={bond.id} value={bond.id}>{bond.regnant_label ?? "Regente"} ({bondDegreeLabel(bond.degree)})</option>)}
            </select>
          </Field>
          <Field label="Ação" htmlFor={`${idp}-action`}><input id={`${idp}-action`} className={inputClass} value={actionText} maxLength={300} onChange={(event) => setActionText(event.target.value)} /></Field>
          <Field label="Rolagem de resistência" htmlFor={`${idp}-roll`} hint="opcional">
            <select id={`${idp}-roll`} className={inputClass} value={rollId} onChange={(event) => setRollId(event.target.value)}>
              <option value="">Sem rolagem</option>
              {rolls.map((roll) => <option key={roll.id} value={roll.id}>{roll.pool} dados · dif. {roll.difficulty} · {roll.outcome.successes} sucessos · {formatWhen(roll.created_at)}</option>)}
            </select>
          </Field>
          <Btn variant="outline" className="w-full" disabled={busy || offline || !bondId || !actionText.trim()} onClick={() => void requestAction()}>Registrar ação</Btn>
        </div>}
        <ul className="mt-3 space-y-2">
          {actions.map((action) => <li key={action.id} className="parchment-inset space-y-2 p-3 text-sm text-ink">
            <p><b>{action.action}</b></p>
            <p className="text-xs text-ink-muted">{formatWhen(action.created_at)} · grau {action.bond_degree}{action.pool ? ` · ${action.pool} dados, dif. ${action.difficulty}: ${action.successes} sucessos (${action.passed ? "passou" : "não passou"})` : " · sem rolagem"}</p>
            <p>Decisão: {action.status}{action.decision_note ? ` · ${action.decision_note}` : ""}</p>
            {api.narrator && action.status === "pendente" && <div className="space-y-2">
              <Field label="Nota" htmlFor={`${idp}-note-${action.id}`}><input id={`${idp}-note-${action.id}`} className={inputClass} value={notes[action.id] ?? ""} maxLength={500} onChange={(event) => setNotes((current) => ({ ...current, [action.id]: event.target.value }))} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Btn size="sm" disabled={busy || offline} onClick={() => void decide(action, "permitida")}>Permitir</Btn>
                <Btn size="sm" variant="outline" disabled={busy || offline} onClick={() => void decide(action, "negada")}>Negar</Btn>
              </div>
            </div>}
          </li>)}
        </ul>
        {!actions.length && <p className="text-sm text-ink-muted">Nenhuma ação registrada.</p>}
      </Panel>
      <StatusLine message={message.text} tone={message.tone} />
    </div>
  );
}
