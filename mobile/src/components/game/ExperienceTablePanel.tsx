import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { FieldValue, SheetTemplate } from "@/lib/sheet-template";
import { purchasableTraits, quoteAdvance } from "@/lib/experience-math";
import {
  ADVANCE_STATUS_LABEL, XP_FIELD, advanceActions, advanceRequest, advanceTraitOptions, canAffordQuote, describeAdvance, int, purchaseBody,
  type AdvanceRequest, type CharacterAdvance, type ServerQuote,
} from "@/lib/game/table-rules";
import { Btn, Panel } from "@/components/nexus/ui";
import { Field, StatusLine, formatWhen, inputClass } from "./TableUi";
import { useOperationIds, type TableApi } from "./useTableApi";

type Sheet = { id: string; name: string; version: number; values: Record<string, FieldValue>; template: SheetTemplate };
type Pending = { request: AdvanceRequest; quote: ServerQuote; version: number; operationId: string };

/**
 * XP advances (mobile), same contract as the web (EXP-02): the server quotes the cost, then the
 * purchase debits XP and raises the trait in one write with expected_version and a stable
 * operation_id (a retry after a lost reply replays instead of charging twice). The narrator
 * approves, rejects or refunds from the remote history. Purchases need the server.
 */
export function ExperienceTablePanel({ sheet, api }: { sheet: Sheet; api: TableApi }) {
  const request = api.request;
  const offline = !api.online;
  const ops = useOperationIds();
  const template = sheet.template;
  const traits = useMemo(() => advanceTraitOptions(template.fields, new Set(purchasableTraits(template))), [template]);
  const labels = useMemo(() => new Map(template.fields.map((field) => [field.id, field.label])), [template]);
  const [trait, setTrait] = useState("");
  const [target, setTarget] = useState(1);
  const [itemName, setItemName] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [advances, setAdvances] = useState<CharacterAdvance[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" }>({ text: "", tone: "info" });

  const option = traits.find((item) => item.id === trait) ?? traits[0];
  const current = option && !option.collection ? int(sheet.values[option.id]) : 0;
  const xp = int(sheet.values[XP_FIELD]);
  const [grant, setGrant] = useState(1);
  const [grantReason, setGrantReason] = useState("");
  const estimate = useMemo(() => {
    if (!option) return { cost: null as number | null, error: "" };
    try { return { cost: quoteAdvance(template, sheet.values, option.id, target, itemName).cost, error: "" }; }
    catch (error) { return { cost: null, error: error instanceof Error ? error.message : "Pedido inválido." }; }
  }, [template, sheet.values, option, target, itemName]);

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    try {
      const rows = await request("GET", `/api/v1/sheets/${sheet.id}/advances?limit=50`);
      setAdvances(Array.isArray(rows) ? rows as CharacterAdvance[] : []);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Não foi possível ler o histórico de XP.", tone: "error" });
    } finally { setLoading(false); }
  }, [request, sheet.id]);

  useEffect(() => {
    setPending(null); setAdvances([]); setTrait(""); setItemName(""); setReason(""); setMessage({ text: "", tone: "info" }); ops.clear();
    if (api.online) void load();
  }, [sheet.id, load, api.online, ops]);

  useEffect(() => { setTarget(Math.min(option?.max ?? 1, current + 1)); }, [option?.id, option?.max, current]);

  async function guard(task: (send: NonNullable<typeof request>) => Promise<void>) {
    if (busy) return;
    if (!request) { setMessage({ text: api.unavailable, tone: "error" }); return; }
    if (offline) { setMessage({ text: "Sem conexão: custo e compra são calculados pelo servidor.", tone: "error" }); return; }
    setBusy(true); setMessage({ text: "", tone: "info" });
    try { await task(request); } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Não foi possível concluir.", tone: "error" });
    } finally { setBusy(false); }
  }

  const quote = () => guard(async (send) => {
    if (!option) throw new Error("Esta ficha não tem traços com custo de XP.");
    const advance = advanceRequest(option.id, target, itemName, option.collection);
    const result = await send("POST", `/api/v1/sheets/${sheet.id}/advances/quote`, advance) as ServerQuote;
    // One operation id per quoted purchase: kept until the server confirms.
    const key = `buy:${JSON.stringify(advance)}:${sheet.version}`;
    setPending({ request: advance, quote: result, version: sheet.version, operationId: ops.take(key) });
  });

  const buy = () => guard(async (send) => {
    if (!pending) return;
    const result = await send("POST", `/api/v1/sheets/${sheet.id}/advances`, purchaseBody(pending.request, pending.version, pending.operationId, reason)) as { advance?: CharacterAdvance; replayed?: boolean };
    ops.done(`buy:${JSON.stringify(pending.request)}:${pending.version}`);
    const advance = result.advance;
    setMessage({ text: advance?.status === "pending"
      ? `Pedido enviado ao narrador: ${advance.cost} XP serão descontados na aprovação.`
      : `${labels.get(pending.request.trait) ?? pending.request.trait} comprado por ${advance?.cost ?? pending.quote.cost} XP.`, tone: "info" });
    setPending(null); setItemName(""); setReason("");
    api.refreshSheet();
    await load();
  });

  const review = (advance: CharacterAdvance, kind: "approve" | "reject" | "cancel" | "refund") => guard(async (send) => {
    if (kind === "refund") await send("POST", `/api/v1/advances/${advance.id}/refund`, { note: null });
    else await send("POST", `/api/v1/advances/${advance.id}/review`, { approve: kind === "approve", note: null });
    setMessage({ text: { approve: "Avanço aprovado e aplicado.", reject: "Avanço recusado.", cancel: "Pedido cancelado.", refund: "Avanço estornado; XP devolvido." }[kind], tone: "info" });
    api.refreshSheet();
    await load();
  });

  // increment_xp has no operation id: a grant is never queued nor retried automatically.
  const grantXp = () => guard(async (send) => {
    const amount = Math.trunc(grant);
    if (!amount || Math.abs(amount) > 1000) throw new Error("Informe de 1 a 1000 XP.");
    await send("POST", `/api/v1/sheets/${sheet.id}/experience`, { amount, reason: grantReason.trim() ? grantReason.trim().slice(0, 200) : null });
    setGrantReason("");
    setMessage({ text: `${amount > 0 ? "Concedidos" : "Removidos"} ${Math.abs(amount)} XP.`, tone: "info" });
    api.refreshSheet();
  });

  const idp = `xp-${sheet.id}`;
  const actionLabel = { approve: "Aprovar", reject: "Recusar", cancel: "Cancelar pedido", refund: "Estornar" } as const;
  return (
    <div className="space-y-4">
      <Panel title="Comprar avanço" actions={<span className="text-sm font-semibold text-ink">{xp} XP</span>}>
        {!traits.length ? <p className="text-sm text-ink-muted">Este modelo não tem traços com custo de XP.</p> : <div className="space-y-3">
          <Field label="Traço" htmlFor={`${idp}-trait`}>
            <select id={`${idp}-trait`} className={inputClass} value={option?.id ?? ""} onChange={(event) => { setTrait(event.target.value); setPending(null); }}>
              {traits.map((item) => <option key={item.id} value={item.id}>{item.label}{item.collection ? "" : ` · ${int(sheet.values[item.id])}`}</option>)}
            </select>
          </Field>
          {option?.collection && <Field label="Nome do item" htmlFor={`${idp}-item`}>
            <input id={`${idp}-item`} className={inputClass} value={itemName} maxLength={120} placeholder="Ex.: Investigação (Cenas de crime)" onChange={(event) => { setItemName(event.target.value); setPending(null); }} />
          </Field>}
          <Field label={option?.collection ? "Nível / pontos" : "Nível desejado"} htmlFor={`${idp}-target`}>
            <select id={`${idp}-target`} className={inputClass} value={target} onChange={(event) => { setTarget(Number(event.target.value)); setPending(null); }}>
              {Array.from({ length: option?.max ?? 1 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </Field>
          <p className="text-sm text-ink" aria-live="polite">Estimativa local: <b>{estimate.cost ?? "—"} XP</b>{estimate.error ? ` · ${estimate.error}` : ""}. Vale o valor do servidor.</p>
          <Btn className="w-full" disabled={busy || Boolean(pending) || offline || !request || estimate.cost === null} onClick={() => void quote()}>{offline ? "Ver custo (precisa de conexão)" : "Ver custo no servidor"}</Btn>
        </div>}
        {pending && <div className="parchment-inset mt-3 space-y-3 p-3" role="group" aria-label="Confirmar compra">
          <p className="text-sm text-ink"><b>{pending.quote.label}</b>: {labels.get(pending.request.trait) ?? pending.request.trait}{pending.request.item_name ? ` (${pending.request.item_name})` : ""} {pending.quote.from_level} → {pending.quote.to_level} custa <b>{pending.quote.cost} XP</b>. Disponível: {pending.quote.xp_available ?? 0} XP.{pending.quote.requires_approval ? " O narrador precisa aprovar." : ""}</p>
          {!canAffordQuote(pending.quote) && <p className="text-sm font-semibold text-destructive">XP insuficiente para este avanço.</p>}
          <Field label="Motivo" htmlFor={`${idp}-reason`} hint="opcional"><input id={`${idp}-reason`} className={inputClass} value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={busy || !canAffordQuote(pending.quote) || offline} onClick={() => void buy()}>{pending.quote.requires_approval ? "Enviar ao narrador" : "Confirmar compra"}</Btn>
            <Btn variant="outline" disabled={busy} onClick={() => setPending(null)}>Cancelar</Btn>
          </div>
        </div>}
      </Panel>

      {api.narrator && <Panel title="Conceder XP">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="XP" htmlFor={`${idp}-grant`} hint="negativo remove">
            <input id={`${idp}-grant`} type="number" inputMode="numeric" min={-1000} max={1000} className={inputClass} value={grant} onChange={(event) => setGrant(Number(event.target.value) || 0)} />
          </Field>
          <Field label="Motivo" htmlFor={`${idp}-greason`} hint="opcional"><input id={`${idp}-greason`} className={inputClass} value={grantReason} maxLength={200} onChange={(event) => setGrantReason(event.target.value)} /></Field>
        </div>
        <Btn variant="outline" className="mt-2 w-full" disabled={busy || offline || !request || !grant} onClick={() => void grantXp()}>Conceder {grant} XP</Btn>
        {offline && <p className="mt-1 text-xs text-ink-muted">A concessão precisa de conexão (não vai para a fila).</p>}
      </Panel>}

      <StatusLine message={message.text} tone={message.tone} />
      <Panel title="Histórico de avanços" actions={<Btn size="sm" variant="ghost" disabled={loading || offline || !request} onClick={() => void load()} aria-label="Recarregar histórico de XP"><RefreshCw className="size-4" aria-hidden />{loading ? "Lendo…" : "Atualizar"}</Btn>}>
        {advances.length === 0 ? <p className="text-sm text-ink-muted">{offline ? "Sem conexão: o histórico aparece ao reconectar." : "Nenhum avanço comprado nesta ficha."}</p> : <ol className="space-y-2">
          {advances.map((advance) => {
            const label = labels.get(advance.trait) ?? advance.trait;
            const options = advanceActions(advance, api.viewerId, api.narrator);
            return <li key={advance.id} className="parchment-inset space-y-2 p-3 text-sm text-ink">
              <p><b>{describeAdvance(advance, label)}</b></p>
              <p className="text-xs text-ink-muted">{ADVANCE_STATUS_LABEL[advance.status] ?? advance.status} · {advance.cost} XP{advance.xp_before !== null ? ` · saldo ${advance.xp_before} → ${advance.xp_after}` : ""}{advance.reason ? ` · ${advance.reason}` : ""} · {formatWhen(advance.created_at)}</p>
              {options.length > 0 && <div className="flex flex-wrap gap-2">
                {options.map((kind) => <Btn key={kind} size="sm" variant={kind === "approve" ? "gold" : "outline"} disabled={busy || offline}
                  onClick={() => { if (kind !== "refund" || window.confirm(`Estornar ${describeAdvance(advance, label)} e devolver ${advance.cost} XP?`)) void review(advance, kind); }}>{actionLabel[kind]}</Btn>)}
              </div>}
            </li>;
          })}
        </ol>}
      </Panel>
    </div>
  );
}
