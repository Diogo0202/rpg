import { createFileRoute } from "@tanstack/react-router";
import { Btn, Empty, LocalGate, PageHeader } from "@/components/nexus/ui";
import { ConnectionStatus, LegacyPanel, OutboxCard, SheetAdjustmentCard, TableAdjustmentCard } from "@/components/nexus/sync/sync-views";
import { useSyncQueue } from "@/components/nexus/sync/use-sync-queue";

export const Route = createFileRoute("/sincronizacao")({
  head: () => ({
    meta: [
      { title: "Sincronização — RPG-Atlas Mobile" },
      { name: "description", content: "Fila local, alterações e conflitos de sincronização." },
      { property: "og:title", content: "Sincronização — RPG-Atlas Mobile" },
      { property: "og:description", content: "Fila local, alterações e conflitos de sincronização." },
    ],
  }),
  component: () => (
    <LocalGate>
      <SyncQueue />
    </LocalGate>
  ),
});

function SyncQueue() {
  const queue = useSyncQueue();
  const offline = queue.refreshing || !queue.engineReady || !queue.connected;
  const empty = !queue.entries.length && !queue.adjustments.length && !queue.tableQueued.length;
  return (
    <>
      {queue.legacyActions.length > 0 && <LegacyPanel actions={queue.legacyActions} />}
      <PageHeader
        title="Sincronização"
        subtitle="As operações ficam persistidas neste aparelho até haver conexão autenticada."
        actions={
          <div className="flex flex-wrap gap-2">
            <Btn disabled={offline} onClick={() => void queue.sync()}>Sincronizar agora</Btn>
            <Btn variant="outline" disabled={offline} onClick={() => void queue.pull()}>
              {queue.refreshing ? "Buscando…" : "Buscar alterações"}
            </Btn>
          </div>
        }
      />
      <ConnectionStatus queue={queue} />
      <div className="mt-4 space-y-3">
        {queue.tableQueued.map((item) => <TableAdjustmentCard key={item.operation_id} item={item} queue={queue} />)}
        {empty && <Empty>A fila local está vazia.</Empty>}
        {queue.entries.map((entry) => <OutboxCard key={entry.mutation.operation_id} entry={entry} queue={queue} />)}
        {queue.adjustments.map((intent) => <SheetAdjustmentCard key={intent.operation_id} intent={intent} />)}
      </div>
    </>
  );
}
