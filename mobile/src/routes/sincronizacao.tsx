import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Btn, Empty, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";
import { outboxSummary, useNexus } from "@/lib/nexus/store";
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
  const { state, engine, refresh } = useNexus();
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const summary = outboxSummary(state);
  const entries = state?.outbox ?? [];

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
      <PageHeader
        title="Sincronização"
        subtitle="As operações ficam persistidas neste aparelho até haver conexão autenticada."
        actions={
          <Btn
            variant="outline"
            disabled={refreshing || !engine}
            onClick={() => void refreshFromServer()}
          >
            {refreshing ? "Buscando…" : "Buscar alterações"}
          </Btn>
        }
      />
      <Panel title="Estado da conexão">
        <div className="flex flex-wrap items-center gap-2">
          <Tag tone="warn">API e login remoto desconectados</Tag>
          <span className="text-sm text-ink">
            {summary.total} operação(ões), {summary.queued} na fila, {summary.conflicts}{" "}
            conflito(s), {summary.blocked} bloqueada(s).
          </span>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          “Buscar alterações” tenta consultar o serviço configurado. Esta prévia ainda não tem
          sessão de usuário nem transporte remoto autenticado.
        </p>
      </Panel>
      <div className="mt-4 space-y-3">
        {!entries.length && <Empty>A fila local está vazia.</Empty>}
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
      </div>
    </>
  );
}
