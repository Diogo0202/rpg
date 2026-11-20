import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTableApi } from "@/components/game/useTableApi";
import { normalizeQueue, type QueuedAction } from "@/lib/game/action-queue";
import type { OutboxEntry } from "@/lib/mobile-sync";
import { prefGet } from "@/lib/nexus/prefs";
import { outboxSummary, useNexus } from "@/lib/nexus/store";
import { legacyQueueKey, reapplyOnBase, receivedBase } from "./sync-model";

const errorMessage = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

/** Fila da versão anterior, guardada sem campanha; fica só para exportação. */
function useLegacyActions(accountId: string | undefined) {
  const [actions, setActions] = useState<QueuedAction[]>([]);
  useEffect(() => {
    let active = true;
    setActions([]);
    if (accountId)
      void prefGet(legacyQueueKey(accountId))
        .then((value) => { if (active) setActions(normalizeQueue(value)); })
        .catch(() => { if (active) toast.error("Falha ao ler pendencias da versao anterior."); });
    return () => {
      active = false;
    };
  }, [accountId]);
  return actions;
}

/** Ações da fila local: sincronizar, buscar, resolver conflitos e cuidar dos ajustes da mesa. */
export function useSyncQueue() {
  const nexus = useNexus();
  const { state, engine, refresh, mode, syncNow, user } = nexus;
  const table = useTableApi();
  const legacyActions = useLegacyActions(user?.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const connected = mode === "connected";

  /** Marca a operação como ocupada enquanto a tarefa roda e mostra o erro, se houver. */
  const withBusy = async (operationId: string, task: () => Promise<void>, fallback: string) => {
    setBusy(operationId);
    try {
      await task();
    } catch (caught) {
      toast.error(errorMessage(caught, fallback));
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } catch (caught) {
      toast.error(errorMessage(caught, "Falha ao sincronizar."));
    } finally {
      setRefreshing(false);
    }
  };

  const pull = async () => {
    if (!engine) return;
    setRefreshing(true);
    try {
      await engine.pull();
      await refresh();
      toast.success("Atualização recebida.");
    } catch (caught) {
      await refresh();
      toast.error(errorMessage(caught, "Não foi possível buscar alterações."));
    } finally {
      setRefreshing(false);
    }
  };

  const keepDraft = async (entry: OutboxEntry) => {
    if (!engine) return;
    const base = receivedBase(state, entry);
    if (!base || base.deleted) {
      toast.error("A base recebida não está disponível. Tente atualizar quando houver conexão.");
      return;
    }
    if (!window.confirm("Reaplicar todos os campos deste rascunho sobre a base recebida mais recente neste aparelho?")) return;
    await withBusy(entry.mutation.operation_id, async () => {
      await engine.resolveConflict(entry.mutation.operation_id, reapplyOnBase(entry.mutation.changes, base));
      await refresh();
      toast.success("Rascunho reaplicado à base guardada. A operação segue na fila local.");
    }, "Não foi possível resolver o conflito.");
  };

  const discardDraft = async (entry: OutboxEntry) => {
    if (!engine) return;
    if (!window.confirm("Descartar este rascunho e manter os valores da base recebida?")) return;
    await withBusy(entry.mutation.operation_id, async () => {
      await engine.discardConflict(entry.mutation.operation_id);
      await refresh();
      toast.success("Rascunho descartado.");
    }, "Não foi possível descartar o rascunho.");
  };

  const retryTable = (operationId: string) => withBusy(operationId, async () => {
    await table.retry(operationId);
    toast.success("Ajuste reenviado.");
  }, "Falha ao reenviar ajuste.");

  const discardTable = async (operationId: string, label: string) => {
    if (!window.confirm(`Descartar o ajuste “${label}” desta fila local?`)) return;
    await withBusy(operationId, async () => {
      await table.discard(operationId);
      toast.success("Ajuste descartado.");
    }, "Falha ao descartar ajuste.");
  };

  return {
    state,
    mode,
    connected,
    engineReady: Boolean(engine),
    connectionMessage: nexus.connectionMessage,
    summary: outboxSummary(state),
    entries: state?.outbox ?? [],
    adjustments: state?.adjustments ?? [],
    tableQueued: table.queued,
    tableOnline: table.online,
    legacyActions,
    busy,
    refreshing,
    sync,
    pull,
    keepDraft,
    discardDraft,
    retryTable,
    discardTable,
  };
}

export type SyncQueueState = ReturnType<typeof useSyncQueue>;
