import { describe, expect, it } from "vitest";
import { SYSTEM_STARTERS } from "../../../../shared/rules/system-starters.ts";
import { parseBackupText } from "../sheet-backup.ts";
import type { SheetField, SheetTemplate } from "../../../../shared/rules/sheet-template.ts";
import { templateFor, computeFormulas, exportSheet, prepareSheetValues, sheetFromBackup, wizardTransition } from "./sheets";

const field = (id: string, kind: SheetField["kind"], expression: string | null = null): SheetField => ({ id, kind, label: id, required: true, options: [], expression });

describe("creation and backup contracts", () => {
  it("keeps the canonical name, strips computed inputs, and exports an importable v1 document", () => {
    const starter = SYSTEM_STARTERS[0]!;
    const prepared = prepareSheetValues(starter.template, { ...starter.values, nome: "  Elisa  ", vigor: 3, saude_max: 999 }, "Old name");
    expect(prepared.errors).toEqual({});
    expect(prepared.name).toBe("Elisa");
    expect(prepared.values.nome).toBe("Elisa");
    expect(prepared.values).not.toHaveProperty("saude_max");
    expect(computeFormulas(starter.template, prepared.values).saude_max).toEqual({ ok: true, value: 6 });
    const document = exportSheet({ name: prepared.name, system_key: starter.id, template_name: starter.template.name, template_version: starter.template.version, values: prepared.values, effects: [] }, []);
    const restored = sheetFromBackup(parseBackupText(JSON.stringify(document))[0]!);
    expect(restored.name).toBe("Elisa");
    expect(restored.values.nome).toBe("Elisa");
    expect(restored.values).not.toHaveProperty("saude_max");
  });

  it("does not skip an invalid intermediate step", () => {
    const template: SheetTemplate = { name: "Custom", version: 1, fields: [field("origin", "select")] };
    template.fields[0]!.options = ["Vale"];
    const steps = [{ fields: [] }, { fields: template.fields }, { fields: [] }];
    expect(wizardTransition(steps, 0, 2, { origin: "Inválido" }, template)).toMatchObject({ step: 1, errors: { origin: expect.any(String) } });
  });

  it("preserves a valid custom template when importing and rejects a forged permission envelope", () => {
    const doc = { format: "rpg-nexus-sheet", format_version: 1, name: "Custom", template: { name: "Minha mesa", version: 1, fields: [field("coragem", "number")] }, values: { coragem: 4 }, effects: [] };
    const parsed = parseBackupText(JSON.stringify(doc))[0]!;
    expect(sheetFromBackup(parsed).template_fields).toEqual(parsed.template.fields);
    expect(() => parseBackupText(JSON.stringify({ ...doc, owner_id: crypto.randomUUID() }))).toThrow();
  });
});

describe("calculation preview", () => {
  it("resolves formulas in dependency order and refuses cycles or missing numeric inputs", () => {
    const template: SheetTemplate = { name: "Custom", version: 1, fields: [field("total", "formula", "bonus + 2"), field("bonus", "formula", "vigor * 3"), field("vigor", "number")] };
    expect(computeFormulas(template, { vigor: 2 }).total).toEqual({ ok: true, value: 8 });
    expect(computeFormulas(template, {}).total?.ok).toBe(false);
    template.fields[1]!.expression = "total + 1";
    expect(computeFormulas(template, { vigor: 2 }).total?.ok).toBe(false);
  });
  it("never rolls a roll field while computing the sheet", () => {
    const template: SheetTemplate = { name: "Custom", version: 1, fields: [field("attack", "roll", "2d10")] };
    expect(computeFormulas(template, {}).attack).toMatchObject({ ok: false });
  });
});


describe("One Ring version compatibility",()=>{
  const sheet={name:"Herói",system_key:"one-ring",template_name:"Modelo antigo",template_version:2,values:{nome:"Herói",corpo:7},effects:[]};
  it("keeps local v2 fields instead of changing to the v3 starter",()=>{const template=templateFor(sheet);expect(template.version).toBe(2);expect(template.fields.some(f=>f.id==="anel_atributos")).toBe(false);expect(template.fields.find(f=>f.id==="pericias_favorecidas")?.max_items).toBe(3);});
  it("prefers the saved approved schema and preserves its profile",()=>{const template={name:"Aprovado",version:3,system_key:"one-ring",rules_profile_version:3,fields:[field("custom","text")]};expect(templateFor({...sheet,template_version:3,template_schema:template}).fields).toEqual(template.fields);});
  it("keeps v1 identifiers when only original values survived",()=>{const template=templateFor({...sheet,template_version:1,values:{forca:4,espirito:5}});expect(template.fields.map(f=>f.id)).toEqual(["forca","espirito"]);});
});
