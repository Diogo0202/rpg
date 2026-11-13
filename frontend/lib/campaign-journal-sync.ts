export const CAMPAIGN_JOURNAL_REALTIME_TABLES = [
  "campaign_sessions",
  "campaign_factions",
  "campaign_events",
  "campaign_event_entity_links",
  "world_entities",
] as const;

type JournalChannel = {
  on(
    type: "postgres_changes",
    filter: { event: "*"; schema: "public"; table: string; filter: string },
    callback: () => void,
  ): JournalChannel;
};

/** Bind campaign-scoped invalidation events; callers reload records under RLS. */
export function bindCampaignJournalRealtime<C extends JournalChannel>(
  channel: C,
  campaignId: string,
  onChange: () => void,
): C {
  for (const table of CAMPAIGN_JOURNAL_REALTIME_TABLES) {
    channel.on("postgres_changes", {
      event: "*",
      schema: "public",
      table,
      filter: `campaign_id=eq.${campaignId}`,
    }, onChange);
  }
  return channel;
}
