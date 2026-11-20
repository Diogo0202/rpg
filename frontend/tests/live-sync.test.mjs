import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyRowChange, canSendPing, connectionLabel, isNewerVersion, liveTopic, presenceMembers, reconnectDelay, roleFromMembership, startRealtimeSync,
} from "../lib/realtime-sync.ts";
import {
  advanceCombatTurn, appendParticipantsToCombat, blankCombatState, CombatStateError, insertCombatParticipants, parseCombatState,
} from "../lib/combat-state.ts";

function fakeRealtime() {
  const channels = [];
  const removed = [];
  return {
    channels, removed,
    client: {
      channel(topic, options) {
        const channel = { topic, options, listeners: 0, callback: null, subscribe(cb) { this.callback = cb; return this; } };
        channels.push(channel);
        return channel;
      },
      removeChannel(channel) { removed.push(channel); return Promise.resolve("ok"); },
    },
  };
}
function fakeScheduler() {
  const timers = [];
  return { timers, set(callback, delayMs) { const timer = { callback, delayMs, cleared: false }; timers.push(timer); return timer; }, clear(timer) { timer.cleared = true; }, run() { const pending = timers.filter((item) => !item.cleared && !item.ran); for (const timer of pending) { timer.ran = true; timer.callback(); } } };
}

test("reconnect delay grows exponentially and is capped", () => {
  assert.deepEqual([1, 2, 3, 4].map((attempt) => reconnectDelay(attempt)), [1000, 2000, 4000, 8000]);
  assert.equal(reconnectDelay(20), 30000);
  assert.equal(reconnectDelay(0), 1000);
  assert.equal(reconnectDelay(Number.NaN, 500, 4000), 500);
  assert.equal(connectionLabel("connected"), "Ao vivo");
  assert.equal(connectionLabel("offline"), "Sem tempo real");
});

test("subscription resyncs on subscribe and reconnects with backoff after errors", () => {
  const realtime = fakeRealtime();
  const scheduler = fakeScheduler();
  const statuses = [];
  let resyncs = 0;
  let bound = 0;
  const sync = startRealtimeSync({
    client: realtime.client, topic: "combat-sync-a", scheduler, baseDelayMs: 100, maxDelayMs: 1000,
    bind: (channel) => { bound += 1; channel.listeners += 1; return channel; },
    onResync: () => { resyncs += 1; },
    onStatus: (status, attempt) => statuses.push(`${status}:${attempt}`),
  });
  assert.equal(realtime.channels.length, 1);
  assert.equal(bound, 1, "listeners attached before subscribing");
  realtime.channels[0].callback("SUBSCRIBED");
  assert.equal(resyncs, 1, "initial subscribe loads a snapshot");

  realtime.channels[0].callback("CHANNEL_ERROR");
  assert.equal(realtime.removed.length, 1, "failed channel is removed");
  assert.equal(scheduler.timers.at(-1).delayMs, 100);
  realtime.channels[0].callback("CLOSED");
  assert.equal(scheduler.timers.length, 1, "late callbacks from the dead channel are ignored");
  scheduler.run();
  assert.equal(realtime.channels.length, 2, "a new channel is opened after the delay");
  realtime.channels[1].callback("TIMED_OUT");
  assert.equal(scheduler.timers.at(-1).delayMs, 200, "second failure doubles the delay");
  scheduler.run();
  realtime.channels[2].callback("SUBSCRIBED");
  assert.equal(resyncs, 2, "reconnect reloads missed changes");
  assert.equal(sync.attempt(), 0, "attempt counter resets after success");
  assert.deepEqual(statuses, ["connecting:0", "connected:0", "reconnecting:1", "reconnecting:1", "reconnecting:2", "reconnecting:2", "connected:0"]);

  sync.stop();
  assert.equal(realtime.removed.at(-1), realtime.channels[2]);
  assert.equal(statuses.at(-1), "offline:0");
  realtime.channels[2].callback("SUBSCRIBED");
  assert.equal(resyncs, 2, "nothing happens after stop");
});

test("manual reconnect replaces the channel and private config is forwarded", () => {
  const realtime = fakeRealtime();
  const scheduler = fakeScheduler();
  const sync = startRealtimeSync({ client: realtime.client, topic: liveTopic("c1"), config: { private: true }, scheduler, bind: (channel) => channel, onResync: () => undefined });
  assert.equal(realtime.channels[0].topic, "campaign:c1:live");
  assert.deepEqual(realtime.channels[0].options, { config: { private: true } });
  realtime.channels[0].callback("CHANNEL_ERROR");
  sync.reconnectNow();
  assert.ok(scheduler.timers[0].cleared, "pending backoff timer is cancelled");
  assert.equal(realtime.channels.length, 2);
  sync.stop();
});

test("row changes respect versions", () => {
  const rows = [{ id: "a", version: 3, title: "A" }, { id: "b", version: 1, title: "B" }];
  assert.equal(isNewerVersion(null, { id: "a", version: 1 }), true);
  assert.equal(applyRowChange(rows, { eventType: "UPDATE", new: { id: "a", version: 2, title: "old" } }), rows, "stale update ignored");
  assert.equal(applyRowChange(rows, { eventType: "UPDATE", new: { id: "a", version: 4, title: "new" } })[0].title, "new");
  assert.equal(applyRowChange(rows, { eventType: "INSERT", new: { id: "c", version: 1, title: "C" } })[0].id, "c");
  assert.equal(applyRowChange(rows, { eventType: "INSERT", new: { id: "a", version: 3, title: "dup" } }).length, 2, "duplicate insert merges");
  assert.deepEqual(applyRowChange(rows, { eventType: "DELETE", old: { id: "b" } }).map((row) => row.id), ["a"]);
  assert.equal(applyRowChange(rows, { eventType: "DELETE", old: {} }), rows);
});

test("presence trusts membership roles, not the payload", () => {
  const roles = { n: "narrador", p: "jogador" };
  const members = presenceMembers({
    p: [{ user_id: "p", name: " Ana ", online_at: "2026-10-25T10:00:00Z" }, { user_id: "p", name: "Ana tab 2", online_at: "2026-10-25T09:00:00Z" }],
    n: [{ user_id: "n", name: "", online_at: "2026-10-25T10:01:00Z", role: "jogador" }],
    x: [{ user_id: "x", name: "Intruso" }],
  }, roles, "p");
  assert.deepEqual(members.map((member) => [member.userId, member.name, member.role, member.self]), [["n", "Membro da campanha", "narrador", false], ["p", "Ana tab 2", "jogador", true]]);
  assert.equal(roleFromMembership("player", true), "narrador");
  assert.equal(roleFromMembership("master", false), "narrador");
  assert.equal(roleFromMembership("guest", false), "convidado");
  assert.equal(canSendPing(null, 0), true);
  assert.equal(canSendPing(1000, 4000), false);
  assert.equal(canSendPing(1000, 6000), true);
});

test("combat state insert keeps the active turn and validates input", () => {
  const ids = ["n1", "n2", "n3"];
  const make = () => ids.shift();
  let state = insertCombatParticipants(blankCombatState(), [{ name: "Ana", initiative: 10 }, { name: "Bruno", initiative: 5 }], make);
  assert.deepEqual(state.participants.map((item) => item.name), ["Ana", "Bruno"]);
  state = advanceCombatTurn(state);
  assert.equal(state.participants[state.turn].name, "Bruno");
  state = insertCombatParticipants(state, [{ name: "Lobo", initiative: 12, kind: "enemy", entity_id: "11111111-1111-4111-8111-111111111111" }], make);
  assert.equal(state.participants[0].name, "Lobo");
  assert.equal(state.participants[state.turn].name, "Bruno", "turn stays with the same participant");
  assert.deepEqual(parseCombatState(state).participants[0], { id: "n3", name: "Lobo", initiative: 12, kind: "enemy", entity_id: "11111111-1111-4111-8111-111111111111" }, "extra fields survive a round trip");
  const generated = parseCombatState({ round: 1, turn: 0, paused: false, participants: [{ id: "g", name: "Ghoul", initiative: 3, health: 7, health_max: 7, origin: { source_kind: "generator" }, kind: "boss" }] });
  assert.deepEqual(generated.participants[0], { id: "g", name: "Ghoul", initiative: 3, health: 7, health_max: 7, origin: { source_kind: "generator" } }, "generator fields survive, invalid kind is dropped");
  assert.equal(advanceCombatTurn(generated).participants[0].health, 7);
  assert.throws(() => insertCombatParticipants(state, [{ name: "ana", initiative: 1 }]), CombatStateError);
  assert.throws(() => insertCombatParticipants(state, [{ name: "Zeca", initiative: 2000 }]), CombatStateError);
  const full = { ...blankCombatState(), participants: Array.from({ length: 50 }, (_, index) => ({ id: `p${index}`, name: `P${index}`, initiative: 1 })) };
  assert.throws(() => insertCombatParticipants(full, [{ name: "Extra", initiative: 1 }]), /no máximo 50/);
  state = advanceCombatTurn(advanceCombatTurn(state));
  assert.equal(state.round, 2);
  assert.equal(parseCombatState({ round: 1, turn: 3, paused: false, participants: [] }) === null, false);
  assert.equal(parseCombatState({ round: 1, turn: 1, paused: false, participants: [{ id: "a", name: "A", initiative: 1 }] }), null);
});

test("appendParticipantsToCombat retries on version conflicts", async () => {
  let version = 4;
  let reads = 0;
  const writes = [];
  const client = {
    from() {
      return {
        select() { return { eq() { return { eq() { return { maybeSingle: async () => { reads += 1; return { data: { state: blankCombatState(), version, active: true }, error: null }; } }; } }; } }; },
        update(values) {
          const filters = {};
          const chain = { eq(column, value) { filters[column] = value; return chain; }, select() { return { maybeSingle: async () => {
            writes.push({ values, filters: { ...filters } });
            if (writes.length === 1) { version += 1; return { data: null, error: null }; } // someone else saved first
            return { data: { id: filters.id, version: filters.version + 1 }, error: null };
          } }; } };
          return chain;
        },
      };
    },
  };
  const result = await appendParticipantsToCombat(client, { campaignId: "c", combatId: "k" }, [{ name: "Goblin", initiative: 7, kind: "enemy" }]);
  assert.equal(reads, 2);
  assert.equal(writes[1].filters.version, 5, "second write uses the re-read version");
  assert.equal(result.version, 6);
  assert.equal(result.state.participants[0].kind, "enemy");
});
