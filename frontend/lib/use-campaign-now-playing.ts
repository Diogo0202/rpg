"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { campaignFilter, useTableChannel } from "./realtime/hooks";
import { browserDb } from "./data/browser";
import { nowPlaying, publishNowPlaying } from "./data/music";
import type { NowPlayingState } from "./spotify-sync";


export type NowPlayingPatch = Partial<Pick<NowPlayingState, "context_uri" | "track_uri" | "track_name" | "position_ms" | "is_playing" | "started_at">>;

/** Estado "tocando agora" da campanha, com Realtime. `publish` só funciona para narrador/dono (RLS). */
export function useCampaignNowPlaying(campaignId: string) {
  const [state, setState] = useState<NowPlayingState | null>(null);
  const [loading, setLoading] = useState(true);
  const stateRef = useRef<NowPlayingState | null>(null);
  stateRef.current = state;

  const loadRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let active = true;
    setState(null);
    setLoading(true);

    async function load() {
      const { data } = await nowPlaying(browserDb(), campaignId);
      if (active) {
        setState((data as NowPlayingState | null) ?? null);
        setLoading(false);
      }
    }

    loadRef.current = () => void load();
    void load();
    return () => {
      active = false;
      loadRef.current = () => undefined;
    };
  }, [campaignId]);

  useTableChannel({
    topic: `campaign-now-playing-${campaignId}`,
    listeners: [{ table: "campaign_now_playing", filter: campaignFilter(campaignId) }],
    onChange: (payload) => {
      if (payload.eventType === "DELETE") setState(null);
      else setState(payload.new as NowPlayingState);
    },
    onState: (status) => { if (status === "SUBSCRIBED") loadRef.current(); },
  });

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
    const { error } = await publishNowPlaying(browserDb(), next);
    if (error) return false;
    setState((current) => ({ ...(current ?? {}), ...next }) as NowPlayingState);
    return true;
  }, [campaignId]);

  return { state, loading, publish };
}
