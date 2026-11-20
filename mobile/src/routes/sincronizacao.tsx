import { prefGet } from "@/lib/nexus/prefs";
import { normalizeQueue, type QueuedAction } from "@/lib/game/action-queue";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Btn, Empty, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";
import { outboxSummary, useNexus } from "@/lib/nexus/store";
import { useTableApi } from "@/components/game/useTableApi";
import type { JsonValue, OutboxEntry, SyncRecord } from "@/lib/mobile-sync";

export const Route = createFileRoute("/sincronizacao")({
  head: () => ({
    meta: [
      { title: "Sincronização — RPG-Atlas Mobile" },
      { name: "description", content: "Fila local, alterações e conflitos de sincronização." },
      { property: "og:title", content: "Sincronização — RPG-Atlas Mobile" },
      {
        property: "og:description",
        content: "Fila local, alterações e conflitos de sincronização.",
      },
    ],
  }),
  component: () => (
    <LocalGate>
      <SyncQueue />
    </LocalGate>
  ),
});

function recordKey(type: string, id: string) {
  return JSON.stringify([type, id]);
}
function valueAt(record: SyncRecord | undefined, path: string[]) {
  let node: JsonValue | undefined = record?.data;
  for (const segment of path) {
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      !Object.prototype.hasOwnProperty.call(node, segment)
    )
      return { exists: false as const };
    node = (node as Record<string, JsonValue>)[segment];
  }
  return node === undefined ? { exists: false as const } : { exists: true as const, value: node };
}
function pretty(value: unknown): string {
  return value === undefined ? "(ausente)" : JSON.stringify(value, null, 2);
}
const STATUS: Record<string, string> = {
  queued: "na fila",
  inflight: "em processamento local",
  accepted: "aguardando confirmação recebida",
  conflict: "conflito",
  denied: "negada",
  invalid: "inválida",
  dependency_failed: "dependência falhou",
};

function SyncQueue() {
  const { state, engine, refresh, mode, syncNow, connectionMessage, user } = useNexus();
  const gameApi = useTableApi();
  const [legacyActions, setLegacyActions] = useState<QueuedAction[]>([]);
  useEffect(() => {
    let active = true;
    setLegacyActions([]);
    if (user?.id) void prefGet(`game-action-queue-v1:${user.id}`).then((value) => {
      if (active) setLegacyActions(normalizeQueue(value));
    }).catch(() => { if (active) toast.error("Falha ao ler pendencias da versao anterior."); });
    return () => { active = false; };
  }, [user?.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const summary = outboxSummary(state);
  const entries = state?.outbox ?? [];
  const adjustments = state?.adjustments ?? [];
  const gameQueued = gameApi.queued;
  const gameFailed = gameQueued.filter((item) => item.state === "failed").length;

  const refreshFromServer = async () => {
    if (!engine) return;
    setRefreshing(true);
    try {
      await engine.pull();
      await refresh();
      toast.success("Atualização recebida.");
    } catch (e) {
      await refresh();
      toast.error(e instanceof Error ? e.message : "Não foi possível buscar alterações.");
    } finally {
      setRefreshing(false);
    }
  };

  const keepDraft = async (entry: OutboxEntry) => {
    if (!engine) return;
    const m = entry.mutation;
    const base = state?.records[recordKey(m.entity_type, m.entity_id)];
    if (!base || base.deleted) {
      toast.error("A base recebida não está disponível. Tente atualizar quando houver conexão.");
      return;
    }
    if (
      !window.confirm(
        "Reaplicar todos os campos deste rascunho sobre a base recebida mais recente neste aparelho?",
      )
    )
      return;
    setBusy(m.operation_id);
    try {
      const changes = m.changes.map((change) => ({
        ...change,
        before: valueAt(base, change.path),
      }));
      await engine.resolveConflict(m.operation_id, changes);
      await refresh();
      toast.success("Rascunho reaplicado à base guardada. A operação segue na fila local.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível resolver o conflito.");
    } finally {
      setBusy(null);
    }
  };
  const discardDraft = async (entry: OutboxEntry) => {
    if (!engine) return;
    const m = entry.mutation;
    if (!window.confirm("Descartar este rascunho e manter os valores da base recebida?")) return;
    setBusy(m.operation_id);
    try {
      await engine.discardConflict(m.operation_id);
      await refresh();
      toast.success("Rascunho descartado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível descartar o rascunho.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {legacyActions.length > 0 && <Panel title="Pendencias da versao anterior">
        <p>{legacyActions.length} operacoes sem campanha registrada. A fila permanece preservada e bloqueada para envio automatico. Exporte os recibos para conferir a campanha antes de recuperar os ajustes.</p>
        <a download="pendencias-mesa-legado.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(legacyActions, null, 2))}`}>Exportar pendencias preservadas</a>
      </Panel>}
      <PageHeader
        title="Sincronização"
        subtitle="As operações ficam persistidas neste aparelho até haver conexão autenticada."
        actions={
          <div className="flex flex-wrap gap-2"><Btn
            disabled={refreshing || !engine || mode !== "connected"}
            onClick={async () => {
              setRefreshing(true);
              try { await syncNow(); }
              catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao sincronizar."); }
              finally { setRefreshing(false); }
            }}
          >Sincronizar agora</Btn><Btn
            variant="outline"
            disabled={refreshing || !engine || mode !== "connected"}
            onClick={() => void refreshFromServer()}
          >
            {refreshing ? "Buscando…" : "Buscar alterações"}
          </Btn></div>
        }
      />
      <Panel title="Estado da conexão">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone={mode === "connected" ? "forest" : "warn"}>{mode === "connected" ? "Campanha da conta autenticada" : "Modo local, sem envio ao servidor"}</Tag>
          <span className="text-sm text-ink">
            {summary.total} operação(ões) de ficha, {summary.queued} na fila, {summary.conflicts}{" "}
            conflito(s), {summary.blocked} bloqueada(s). Mesa: {gameQueued.length} ajuste(s), {gameFailed} com erro.
          </span>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          {connectionMessage || (mode === "local" ? "Conecte uma conta e escolha a campanha em Mais > Configurações. Os dados demonstrativos permanecem separados." : "Alterações só saem da fila após confirmação da API. Conflitos exigem sua escolha.")}
        </p>
      </Panel>
      <div className="mt-4 space-y-3">
        {gameQueued.map((item) => (
          <Panel key={item.operation_id} title={`Mesa · ${item.label}`} actions={<Tag tone={item.state === "failed" ? "warn" : "ink"}>{item.state === "failed" ? "erro" : "na fila"}</Tag>}>
            <dl className="grid gap-x-3 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
              <dt>Ficha</dt><dd className="break-all font-mono">{item.sheet_id}</dd>
              <dt>Criado</dt><dd>{new Date(item.created_at).toLocaleString()}</dd>
              <dt>Tentativas</dt><dd>{item.attempts}</dd>
            </dl>
            {item.last_error && <p className="mt-2 text-sm text-destructive">{item.last_error}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn size="sm" disabled={!!busy || mode !== "connected" || !gameApi.online} onClick={async () => {
                setBusy(item.operation_id);
                try { await gameApi.retry(item.operation_id); toast.success("Ajuste reenviado."); }
                catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao reenviar ajuste."); }
                finally { setBusy(null); }
              }}>Tentar de novo</Btn>
              <Btn size="sm" variant="outline" disabled={!!busy} onClick={async () => {
                if (!window.confirm(`Descartar o ajuste “${item.label}” desta fila local?`)) return;
                setBusy(item.operation_id);
                try { await gameApi.discard(item.operation_id); toast.success("Ajuste descartado."); }
                catch (error) { toast.error(error instanceof Error ? error.message : "Falha ao descartar ajuste."); }
                finally { setBusy(null); }
              }}>Descartar</Btn>
            </div>
          </Panel>
        ))}
        {!entries.length && !adjustments.length && !gameQueued.length && <Empty>A fila local está vazia.</Empty>}
        {entries.map((entry) => {
          const mutation = entry.mutation;
          const base = state?.records[recordKey(mutation.entity_type, mutation.entity_id)];
          const isConflict = entry.state === "conflict";
          return (
            <Panel
              key={mutation.operation_id}
              title={`${mutation.entity_type} · ${mutation.action}`}
              actions={
                <Tag tone={isConflict ? "warn" : "ink"}>{STATUS[entry.state] ?? entry.state}</Tag>
              }
            >
              <dl className="grid gap-x-3 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
                <dt>Operação</dt>
                <dd className="break-all font-mono">{mutation.operation_id}</dd>
                <dt>Registro</dt>
                <dd className="break-all font-mono">{mutation.entity_id}</dd>
                <dt>Versão base</dt>
                <dd>{mutation.base_version}</dd>
                <dt>Tentativas</dt>
                <dd>{entry.attempts}</dd>
              </dl>
              {entry.lastError && (
                <p className="mt-2 text-sm text-destructive">{entry.lastError}</p>
              )}
              {mutation.changes.length > 0 && (
                <div className="mt-3 space-y-2">
                  {mutation.changes.map((change, index) => {
                    const received = valueAt(base, change.path);
                    return (
                      <section
                        key={`${mutation.operation_id}-${index}`}
                        className="parchment-inset grid gap-2 p-3 sm:grid-cols-3"
                      >
                        <p className="break-all text-xs font-semibold text-ink sm:col-span-3">
                          {change.path.join(" → ")}
                        </p>
                        <div>
                          <p className="text-xs font-semibold text-ink-muted">Antes do rascunho</p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">
                            {pretty(change.before.exists ? change.before.value : undefined)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-ink-muted">Meu rascunho</p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">
                            {pretty(change.after.exists ? change.after.value : undefined)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-ink-muted">
                            Base recebida neste aparelho
                            {base ? ` · v${base.version}` : " · indisponível"}
                          </p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">
                            {pretty(received.exists ? received.value : undefined)}
                          </pre>
                        </div>
                      </section>
                    );
                  })}
                </div>
              )}
              {isConflict && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn size="sm" disabled={!!busy} onClick={() => void keepDraft(entry)}>
                    {busy === mutation.operation_id ? "Salvando…" : "Manter meu rascunho"}
                  </Btn>
                  <Btn
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void discardDraft(entry)}
                  >
                    Usar base recebida
                  </Btn>
                </div>
              )}
            </Panel>
          );
        })}
        {adjustments.map((intent) => (
          <Panel key={intent.operation_id} title={`Ajuste · ${intent.field_id}`} actions={<Tag tone={intent.state === "queued" || intent.state === "inflight" ? "warn" : "ink"}>{STATUS[intent.state] ?? intent.state}</Tag>}>
            <dl className="grid gap-x-3 gap-y-1 text-xs text-ink-muted sm:grid-cols-2">
              <dt>Operação</dt><dd className="break-all font-mono">{intent.operation_id}</dd>
              <dt>Ficha</dt><dd className="break-all font-mono">{intent.sheet_id}</dd>
              <dt>Delta solicitado</dt><dd>{intent.delta > 0 ? "+" : ""}{intent.delta}</dd>
              <dt>Criado</dt><dd>{new Date(intent.created_at).toLocaleString()}</dd>
            </dl>
            {intent.reason && <p className="mt-2 text-sm text-ink-muted">Motivo: {intent.reason}</p>}
            {intent.last_error && <p className="mt-2 text-sm text-destructive">{intent.last_error}</p>}
          </Panel>
        ))}
      </div>
    </>
  );
}
