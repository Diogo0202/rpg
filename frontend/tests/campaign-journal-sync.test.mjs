import assert from "node:assert/strict";
import { test } from "node:test";
import { bindCampaignJournalRealtime, CAMPAIGN_JOURNAL_REALTIME_TABLES } from "../lib/campaign-journal-sync.ts";

test("journal realtime invalidates only the selected campaign tables", () => {
  const listeners = [];
  const channel = { on(type, filter, callback) { listeners.push({ type, filter, callback }); return this; } };
  let refreshes = 0;
  const result = bindCampaignJournalRealtime(channel, "campaign-42", () => { refreshes += 1; });

  assert.equal(result, channel);
  assert.deepEqual(listeners.map((entry) => entry.filter.table), CAMPAIGN_JOURNAL_REALTIME_TABLES);
  assert.ok(listeners.every((entry) => entry.type === "postgres_changes"));
  assert.ok(listeners.every((entry) => entry.filter.filter === "campaign_id=eq.campaign-42"));
  listeners[2].callback();
  assert.equal(refreshes, 1);
});
