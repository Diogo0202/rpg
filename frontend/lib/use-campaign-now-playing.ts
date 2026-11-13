"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createClient } from "./supabase/client";
import type { NowPlayingState } from "./spotify-sync";

const COLUMNS = "campaign_id,context_uri,track_uri,track_name,position_ms,is_playing,started_at,updated_by,updated_at";

export type NowPlayingPatch = Partial<Pick<NowPlayingState, "context_uri" | "track_uri" | "track_name" | "position_ms" | "is_playing" | "started_at">>;

/** Estado "tocando agora" da campanha, com Realtime. `publish` só funciona para narrador/dono (RLS). */
export function useCampaignNowPlaying(campaignId: string) {
  const [state, setState] = useState<NowPlayingState | null>(null);
  const [loading, setLoading] = useState(true);
  const stateRef = useRef<NowPlayingState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    setState(null);
    setLoading(true);

    async function load() {
      const { data } = await supabase.from("campaign_now_playing").select(COLUMNS).eq("campaign_id", campaignId).maybeSingle();
      if (active) {
        setState((data as NowPlayingState | null) ?? null);
        setLoading(false);
      }
    }

    const channel = supabase
      .channel(`campaign-now-playing-${campaignId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaign_now_playing", filter: `campaign_id=eq.${campaignId}` },
        (payload) => {
          if (!active) return;
          if (payload.eventType === "DELETE") setState(null);
          else setState(payload.new as NowPlayingState);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
      });
    void load();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const publish = useCallback(async (patch: NowPlayingPatch): Promise<boolean> => {
    const base = stateRef.current;
    const next = {
      campaign_id: campaignId,
      context_uri: base?.context_uri ?? null,
      track_uri: base?.track_uri ?? null,
      track_name: base?.track_name ?? null,
      position_ms: base?.position_ms ?? 0,
      is_playing: base?.is_playing ?? false,
      started_at: base?.started_at ?? null,
      ...patch,
    };
    const { error } = await createClient().from("campaign_now_playing").upsert(next, { onConflict: "campaign_id" });
    if (error) return false;
    setState((current) => ({ ...(current ?? {}), ...next }) as NowPlayingState);
    return true;
  }, [campaignId]);

  return { state, loading, publish };
}
