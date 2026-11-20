"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

import { createClient } from "../supabase/client";
import { startRealtimeSync, type RealtimeConnection, type RealtimeSync } from "../realtime-sync";

/**
 * Adaptadores React do tempo real. As telas declaram o tópico e o que escutam;
 * criar o cliente, assinar o canal e removê-lo na desmontagem fica aqui.
 */

export type TableEvent = "*" | "INSERT" | "UPDATE" | "DELETE";
export type TableListener = { table: string; event?: TableEvent; filter?: string };
export type TableChange = RealtimePostgresChangesPayload<Record<string, unknown>>;
/** Estados do `subscribe` mais `UNAVAILABLE`, quando o Supabase não está configurado. */
export type ChannelState = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | "UNAVAILABLE";

export function campaignFilter(campaignId: string): string {
  return `campaign_id=eq.${campaignId}`;
}

/** Canal simples de `postgres_changes`, sem reconexão própria. `topic` nulo desliga o canal. */
export function useTableChannel(options: {
  topic: string | null;
  listeners: readonly TableListener[];
  onChange: (change: TableChange) => void;
  onState?: (state: ChannelState) => void;
}): void {
  const onChange = useRef(options.onChange);
  const onState = useRef(options.onState);
  useEffect(() => {
    onChange.current = options.onChange;
    onState.current = options.onState;
  });
  const { topic } = options;
  const listenersKey = JSON.stringify(options.listeners);

  useEffect(() => {
    if (!topic) return;
    const listeners = JSON.parse(listenersKey) as TableListener[];
    let active = true;
    let client: ReturnType<typeof createClient>;
    try { client = createClient(); } catch { onState.current?.("UNAVAILABLE"); return; }
    let channel = client.channel(topic);
    for (const listener of listeners) {
      channel = channel.on(
        "postgres_changes",
        { event: listener.event ?? "*", schema: "public", table: listener.table, ...(listener.filter ? { filter: listener.filter } : {}) },
        (payload) => { if (active) onChange.current(payload); },
      );
    }
    channel.subscribe((status) => { if (active) onState.current?.(status as ChannelState); });
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [topic, listenersKey]);
}

/**
 * Canal com reconexão e ressincronização (`startRealtimeSync`). `bind` recebe `live()`,
 * que fica falso depois que o canal é trocado ou a tela desmonta.
 */
export function useRealtimeSync(options: {
  topic: string | null;
  config?: Record<string, unknown>;
  bind: (channel: RealtimeChannel, live: () => boolean) => RealtimeChannel;
  onResync: () => void;
  onChannel?: (channel: RealtimeChannel | null) => void;
}): { status: RealtimeConnection; reconnectNow: () => void } {
  const [status, setStatus] = useState<RealtimeConnection>("connecting");
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; });
  const syncRef = useRef<RealtimeSync | null>(null);
  const { topic } = options;
  const configKey = options.config ? JSON.stringify(options.config) : "";

  useEffect(() => {
    if (!topic) { setStatus("offline"); return; }
    let active = true;
    const live = () => active;
    setStatus("connecting");
    let client: ReturnType<typeof createClient>;
    try { client = createClient(); } catch { setStatus("offline"); return () => { active = false; }; }
    const sync = startRealtimeSync<RealtimeChannel>({
      client,
      topic,
      config: configKey ? JSON.parse(configKey) as Record<string, unknown> : undefined,
      bind: (channel) => callbacks.current.bind(channel, live),
      onChannel: (channel) => callbacks.current.onChannel?.(channel),
      onStatus: (next) => { if (active) setStatus(next); },
      onResync: () => { if (active) callbacks.current.onResync(); },
    });
    syncRef.current = sync;
    return () => {
      active = false;
      syncRef.current = null;
      sync.stop();
    };
  }, [topic, configKey]);

  const reconnectNow = useCallback(() => syncRef.current?.reconnectNow(), []);
  return { status, reconnectNow };
}
