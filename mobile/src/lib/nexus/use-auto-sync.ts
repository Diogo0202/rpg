import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, type RefObject } from "react";
import type { SyncEngine } from "@/lib/mobile-sync/index.ts";
import { blockTableCampaign } from "@/lib/game/table-queue-storage";

/** Espera curta para juntar avisos seguidos de ficha numa só sincronização. */
const DEBOUNCE_MS = 180;
const STOP_REASONS = new Set(["network", "retry_later", "reauth_required", "revoked"]);

type Options = {
  auth: SupabaseClient | null;
  connected: boolean;
  userId: string | undefined;
  campaignId: string;
  engineRef: RefObject<SyncEngine | null>;
  authAccountRef: RefObject<string | null>;
  load: (engine: SyncEngine) => Promise<void>;
  onIdleError: (message: string) => void;
};

/**
 * Com uma campanha conectada, escuta os avisos de ficha da campanha e sincroniza.
 * Avisos que chegam durante uma rodada pedem mais uma rodada; nenhuma roda em paralelo.
 */
export function useAutoSync({ auth, connected, userId, campaignId, engineRef, authAccountRef, load, onIdleError }: Options) {
  useEffect(() => {
    const active = engineRef.current;
    if (!auth || !connected || !userId || !campaignId || !active
      || active.partition.accountId !== userId || active.partition.campaignId !== campaignId) return;
    let alive = true;
    let busy = false;
    let requested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stillActive = () => alive && authAccountRef.current === userId && engineRef.current === active;

    const run = async () => {
      if (busy) { requested = true; return; }
      busy = true;
      try {
        do {
          requested = false;
          if (!stillActive()) return;
          const report = await active.sync();
          if (report.reason === "revoked") await blockTableCampaign(active.partition.accountId, active.partition.campaignId);
          if (report.reason && STOP_REASONS.has(report.reason)) {
            await load(active);
            return;
          }
          await active.pull();
          await load(active);
        } while (requested && alive);
      } catch {
        if (alive && engineRef.current === active) onIdleError("A atualização automática aguarda uma conexão válida.");
      } finally {
        busy = false;
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; void run(); }, DEBOUNCE_MS);
    };
    const filter = `campaign_id=eq.${campaignId}`;
    const channel = auth.channel(`mobile-sheet-sync-${userId}-${campaignId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "character_sheet_notifications", filter }, schedule)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "character_sheet_notifications", filter }, schedule)
      .subscribe((status) => { if (alive && status === "SUBSCRIBED") schedule(); });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      void auth.removeChannel(channel);
    };
  }, [auth, connected, userId, campaignId, engineRef, authAccountRef, load, onIdleError]);
}
