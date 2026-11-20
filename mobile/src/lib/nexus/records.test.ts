import { describe, expect, it } from "vitest";
import type { SyncState } from "@/lib/mobile-sync/index.ts";
import { knownEntityIds, nextSessionSequence, readPath, sheetFieldRoles, sheetValueChanges, toEntity, templatesById } from "./records";

function stateWith(partial: Partial<SyncState>): SyncState {
  return {
    schema: "rpg-nexus-mobile-v1",
    partition: { accountId: "a", campaignId: "c", deviceId: "d" },
    cursor: null,
    records: {},
    outbox: [],
    updatedAt: 1,
    ...partial,
  };
}

describe("records", () => {
  it("reads nested paths and reports missing ones", () => {
    expect(readPath({ a: { b: 2 } }, ["a", "b"])).toEqual({ exists: true, value: 2 });
    expect(readPath({ a: { b: 2 } }, ["a", "c"])).toEqual({ exists: false });
    expect(readPath({ a: [1] }, ["a", "0"])).toEqual({ exists: false });
  });

  it("numbers the next session after saved and queued sessions", () => {
    const state = stateWith({
      records: { s1: { entity_type: "campaign_sessions", id: "s1", version: 1, data: { sequence: 3 } } },
      outbox: [{
        state: "queued", createdAt: 1, attempts: 0, nextAttemptAt: 0,
        mutation: { operation_id: "op", entity_type: "campaign_sessions", entity_id: "s2", action: "create", base_version: 0, depends_on: [],
          changes: [{ path: ["sequence"], before: { exists: false }, after: { exists: true, value: 5 } }] },
      }],
    });
    expect(nextSessionSequence(state)).toBe(6);
    expect(nextSessionSequence(stateWith({}))).toBe(1);
  });

  it("lists cached and queued entities once, under the interface name", () => {
    const state = stateWith({
      records: { e1: { entity_type: "campaign_events", id: "e1", version: 1, data: {} } },
      outbox: [{
        state: "queued", createdAt: 1, attempts: 0, nextAttemptAt: 0,
        mutation: { operation_id: "op", entity_type: "campaign_events", entity_id: "e1", action: "update", base_version: 1, depends_on: [], changes: [] },
      }],
    });
    expect(knownEntityIds(state)).toEqual([["campaign_events", "e1"]]);
  });

  it("sends small free numeric changes as atomic deltas and the rest as path changes", () => {
    const roles = sheetFieldRoles({
      fields: [{ id: "hp", kind: "number" }, { id: "xp", kind: "number" }, { id: "big", kind: "number" }, { id: "name", kind: "text" }],
      experience_field: "xp",
    });
    const result = sheetValueChanges({ hp: 5, xp: 1, big: 0, name: "A" }, { hp: 3, xp: 4, big: 5000, name: "B" }, roles);
    expect(result.deltas).toEqual([{ fieldId: "hp", delta: -2 }]);
    expect(result.changes.map((change) => change.path[1]).sort()).toEqual(["big", "name", "xp"]);
  });

  it("copies template data into connected character sheets", () => {
    const state = stateWith({
      records: { t1: { entity_type: "system_templates", id: "t1", version: 1, data: { name: "V5", version: 2, schema: { system_key: "v5", fields: [] } } } },
    });
    const entity = toEntity("character_sheets", { entity_type: "character_sheets", id: "s1", version: 1, data: { template_id: "t1", values: {} } }, state, true, templatesById(state));
    expect(entity.data).toMatchObject({ system_key: "v5", template_name: "V5", template_version: 2, template_fields: [], effects: [] });
    expect(entity.pending).toBe(false);
  });
});
