import { describe, expect, it } from "vitest";
import { fromRemoteRecord, makeSheetStarter, remoteEntityType, toRemoteCreate, toRemotePath } from "./remote-adapter";

describe("remote model adapters", () => {
  it("normalizes world body and creates only API-supported fields", () => {
    const record = fromRemoteRecord("world_entities", {
      entity_type: "world_entities", id: "00000000-0000-4000-8000-000000000001", version: 1,
      data: { kind: "npc", name: "Mara", body: { description: "Farol", tags: ["aliada"] } },
    });
    expect(record.data).toMatchObject({ description: "Farol", tags: ["aliada"] });
    expect(toRemoteCreate("world_entities", { kind: "npc", name: "Mara", description: "Farol", tags: ["aliada"] })).toEqual({
      entityType: "world_entities", data: { kind: "npc", name: "Mara", body: { description: "Farol", tags: ["aliada"] } },
    });
    expect(toRemotePath("world_entities", ["description"], "Novo texto")).toEqual({ entityType: "world_entities", path: ["body", "description"], value: "Novo texto" });
  });

  it("maps maps documents and refuses marker fields the server cannot store", () => {
    const map = toRemoteCreate("maps", { name: "Porto", columns: 12, rows: 8, description: "Costa" });
    expect(map).toEqual({ entityType: "maps", data: { name: "Porto", document: { width: 12, height: 8, description: "Costa", layers: [], markers: [], grid_enabled: true } } });
    expect(toRemotePath("maps", ["columns"], 10)).toEqual({ entityType: "maps", path: ["document", "width"], value: 10 });
    expect(() => toRemoteCreate("map_pins", { map_id: "map", label: "Porta", x: 0.4, y: 0.3, note: "segredo" })).toThrow(/nota/);
    expect(() => toRemoteCreate("map_pins", { map_id: "map", label: "Porta", x: 0.4, y: 0.3, note: "" })).toThrow(/vinculados a uma entidade/);
    expect(toRemotePath("map_pins", ["note"], "")).toBeNull();
  });

  it("uses campaign-native template IDs and blocks unsupported local records", () => {
    expect(remoteEntityType("journal_sessions")).toBe("campaign_sessions");
    expect(() => remoteEntityType("campaign_state")).toThrow(/somente neste aparelho/);
    const starter = makeSheetStarter({
      id: "00000000-0000-4000-8000-000000000005", name: "Modelo aprovado", version: 3,
      schema: { name: "Modelo aprovado", fields: [{ id: "nome", label: "Nome", kind: "text", required: true, options: [], expression: null, character_name: true }] },
    });
    expect(starter).toMatchObject({ templateId: "00000000-0000-4000-8000-000000000005", template: { name: "Modelo aprovado", version: 3 } });
    const rules = [{ type: "select_grants", id: "cla_disciplinas", label: "Disciplinas do clã", field: "cla", fields: ["disc_rapidez"], cases: [{ equals: "Brujah", add: { disc_rapidez: 1 } }] }];
    const ruled = makeSheetStarter({ id: "00000000-0000-4000-8000-000000000006", name: "V5", version: 1, schema: { fields: [{ id: "cla", label: "Clã", kind: "select", options: ["Brujah"] }], creation_rules: rules } });
    expect(ruled?.template.creation_rules).toEqual(rules);
    expect(makeSheetStarter({ id: "id", name: "Unsupported", version: 1, schema: { rules_profile_version: 1, fields: [] } })).toBeNull();
    expect(toRemoteCreate("character_sheets", { template_id: "00000000-0000-4000-8000-000000000005", name: "Mara", values: { nome: "Mara" } })).toEqual({
      entityType: "character_sheets", data: { template_id: "00000000-0000-4000-8000-000000000005", name: "Mara", values: { nome: "Mara" } },
    });
    expect(() => toRemoteCreate("character_sheets", { template_id: "bad", name: "Mara", values: {}, effects: [] })).toThrow(/campo\(s\) sem suporte/);
  });

  it("removes database metadata from inventory view data and validates native session sequence", () => {
    const inventory = fromRemoteRecord("character_inventory", {
      entity_type: "character_inventory", id: "00000000-0000-4000-8000-000000000009", version: 3,
      data: { id: "00000000-0000-4000-8000-000000000009", campaign_id: "campaign", owner_id: "owner", updated_at: "now", sheet_id: "sheet", name: "Espada", quantity: 1 },
    });
    expect(inventory.data).toEqual({ sheet_id: "sheet", name: "Espada", quantity: 1 });
    const session = fromRemoteRecord("journal_sessions", {
      entity_type: "campaign_sessions", id: "00000000-0000-4000-8000-000000000010", version: 4,
      data: { title: "Sessão", played_on: "2026-10-20", sequence: 4, status: "planned" },
    });
    expect(session.data).toMatchObject({ session_date: "2026-10-20", sequence: 4 });
    expect(toRemoteCreate("journal_sessions", { title: "Sessão", session_date: "2026-10-20", sequence: 4 })).toEqual({
      entityType: "campaign_sessions", data: { title: "Sessão", played_on: "2026-10-20", sequence: 4, status: "planned" },
    });
    expect(() => toRemoteCreate("journal_sessions", { title: "Sessão", session_date: "2026-10-20" })).toThrow(/sequência/);
  });
});
