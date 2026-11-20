import type { ReactNode } from "react";
import { Btn, Panel, Tag } from "@/components/nexus/ui";
import type { QueuedAction } from "@/lib/game/action-queue";
import type { OutboxEntry, SheetAdjustmentIntent, SyncChange, SyncRecord } from "@/lib/mobile-sync";
import { pretty, receivedBase, statusLabel, valueAt } from "./sync-model";
import type { SyncQueueState } from "./use-sync-queue";

type TableItem = SyncQueueState["tableQueued"][number];

function Details({ rows }: { rows: Array<[string, ReactNode, boolean?]> }) {
  return (
    <dl className="grid gap-x-3 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
      {rows.map(([label, value, mono]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd className={mono ? "break-all font-mono" : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LegacyPanel({ actions }: { actions: QueuedAction[] }) {
  return (
    <Panel title="Pendencias da versao anterior">
      <p>{actions.length} operacoes sem campanha registrada. A fila permanece preservada e bloqueada para envio automatico. Exporte os recibos para conferir a campanha antes de recuperar os ajustes.</p>
      <a download="pendencias-mesa-legado.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(actions, null, 2))}`}>Exportar pendencias preservadas</a>
    </Panel>
  );
}

export function ConnectionStatus({ queue }: { queue: SyncQueueState }) {
  const { summary, connected, tableQueued } = queue;
  const tableFailed = tableQueued.filter((item) => item.state === "failed").length;
  const fallback = connected
    ? "Alterações só saem da fila após confirmação da API. Conflitos exigem sua escolha."
    : "Conecte uma conta e escolha a campanha em Mais > Configurações. Os dados demonstrativos permanecem separados.";
  return (
    <Panel title="Estado da conexão">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={connected ? "forest" : "warn"}>{connected ? "Campanha da conta autenticada" : "Modo local, sem envio ao servidor"}</Tag>
        <span className="text-sm text-ink">
          {summary.total} operação(ões) de ficha, {summary.queued} na fila, {summary.conflicts}{" "}
          conflito(s), {summary.blocked} bloqueada(s). Mesa: {tableQueued.length} ajuste(s), {tableFailed} com erro.
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-muted">{queue.connectionMessage || fallback}</p>
    </Panel>
  );
}

export function TableAdjustmentCard({ item, queue }: { item: TableItem; queue: SyncQueueState }) {
  const failed = item.state === "failed";
  return (
    <Panel title={`Mesa · ${item.label}`} actions={<Tag tone={failed ? "warn" : "ink"}>{failed ? "erro" : "na fila"}</Tag>}>
      <Details rows={[["Ficha", item.sheet_id, true], ["Criado", new Date(item.created_at).toLocaleString()], ["Tentativas", item.attempts]]} />
      {item.last_error && <p className="mt-2 text-sm text-destructive">{item.last_error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn size="sm" disabled={!!queue.busy || !queue.connected || !queue.tableOnline} onClick={() => void queue.retryTable(item.operation_id)}>Tentar de novo</Btn>
        <Btn size="sm" variant="outline" disabled={!!queue.busy} onClick={() => void queue.discardTable(item.operation_id, item.label)}>Descartar</Btn>
      </div>
    </Panel>
  );
}

function Column({ title, children }: { title: string; children: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink-muted">{title}</p>
      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">{children}</pre>
    </div>
  );
}

/** Antes, rascunho e base recebida lado a lado para um campo da operação. */
function ChangeDiff({ change, base }: { change: SyncChange; base: SyncRecord | undefined }) {
  return (
    <section className="parchment-inset grid gap-2 p-3 sm:grid-cols-3">
      <p className="break-all text-xs font-semibold text-ink sm:col-span-3">{change.path.join(" → ")}</p>
      <Column title="Antes do rascunho">{pretty(change.before)}</Column>
      <Column title="Meu rascunho">{pretty(change.after)}</Column>
      <Column title={`Base recebida neste aparelho${base ? ` · v${base.version}` : " · indisponível"}`}>{pretty(valueAt(base, change.path))}</Column>
    </section>
  );
}

export function OutboxCard({ entry, queue }: { entry: OutboxEntry; queue: SyncQueueState }) {
  const { mutation } = entry;
  const base = receivedBase(queue.state, entry);
  const isConflict = entry.state === "conflict";
  return (
    <Panel title={`${mutation.entity_type} · ${mutation.action}`} actions={<Tag tone={isConflict ? "warn" : "ink"}>{statusLabel(entry.state)}</Tag>}>
      <Details rows={[["Operação", mutation.operation_id, true], ["Registro", mutation.entity_id, true], ["Versão base", mutation.base_version], ["Tentativas", entry.attempts]]} />
      {entry.lastError && <p className="mt-2 text-sm text-destructive">{entry.lastError}</p>}
      {mutation.changes.length > 0 && (
        <div className="mt-3 space-y-2">
          {mutation.changes.map((change, index) => <ChangeDiff key={`${mutation.operation_id}-${index}`} change={change} base={base} />)}
        </div>
      )}
      {isConflict && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn size="sm" disabled={!!queue.busy} onClick={() => void queue.keepDraft(entry)}>
            {queue.busy === mutation.operation_id ? "Salvando…" : "Manter meu rascunho"}
          </Btn>
          <Btn size="sm" variant="outline" disabled={!!queue.busy} onClick={() => void queue.discardDraft(entry)}>Usar base recebida</Btn>
        </div>
      )}
    </Panel>
  );
}

export function SheetAdjustmentCard({ intent }: { intent: SheetAdjustmentIntent }) {
  const waiting = intent.state === "queued" || intent.state === "inflight";
  return (
    <Panel title={`Ajuste · ${intent.field_id}`} actions={<Tag tone={waiting ? "warn" : "ink"}>{statusLabel(intent.state)}</Tag>}>
      <Details rows={[
        ["Operação", intent.operation_id, true],
        ["Ficha", intent.sheet_id, true],
        ["Delta solicitado", `${intent.delta > 0 ? "+" : ""}${intent.delta}`],
        ["Criado", new Date(intent.created_at).toLocaleString()],
      ]} />
      {intent.reason && <p className="mt-2 text-sm text-ink-muted">Motivo: {intent.reason}</p>}
      {intent.last_error && <p className="mt-2 text-sm text-destructive">{intent.last_error}</p>}
    </Panel>
  );
}
