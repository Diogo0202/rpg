import { describe, expect, it } from "vitest";
import { SYSTEM_STARTERS } from "../system-starters.ts";
import { exportSheet } from "./sheets";
import { importedSheetInput } from "./sheet-import";

describe("campaign backup import", () => {
  const starter = SYSTEM_STARTERS[0]!;
  const document = exportSheet({ name: "Lia", system_key: starter.id, template_name: starter.template.name, template_version: starter.template.version, values: { ...starter.values, nome: "Lia" }, effects: [] }, []);
  const id = "00000000-0000-4000-8000-000000000001";
  const template = { id, data: JSON.parse(JSON.stringify({ name: starter.template.name, version: starter.template.version, status: "approved", schema: starter.template })) };
  it("sends only the approved campaign template ID and base inputs, with no imported ownership", () => {
    const result = importedSheetInput(document, "connected", [template]);
    expect(Object.keys(result).sort()).toEqual(["name", "template_id", "values"]);
    expect(result.template_id).toBe(id);
    expect(result.name).toBe("Lia");
  });
  it("rejects incompatible or ambiguous models before writing any document", () => {
    expect(() => importedSheetInput(document, "connected", [])).toThrow(/modelo aprovado/);
    expect(() => importedSheetInput(document, "connected", [template, { ...template, id: "00000000-0000-4000-8000-000000000002" }])).toThrow(/único modelo/);
    const incompatible = structuredClone(template);
    incompatible.data.schema.fields[0].required = !incompatible.data.schema.fields[0].required;
    expect(() => importedSheetInput(document, "connected", [incompatible])).toThrow(/modelo aprovado/);
  });
});
