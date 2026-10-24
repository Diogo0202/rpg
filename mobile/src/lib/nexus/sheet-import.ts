import type { JsonValue } from "../mobile-sync/index.ts";
import { mechanicallyEquivalentFields, type SheetBackup } from "../sheet-backup.ts";
import type { SheetTemplate } from "../sheet-template.ts";
import { prepareSheetValues, sheetFromBackup } from "./sheets";

type CampaignTemplate = { id: string; data: Record<string, JsonValue> };

export function importedSheetInput(doc: SheetBackup, mode: "local" | "connected", templates: CampaignTemplate[]): Record<string, JsonValue> {
  if (mode === "local") return JSON.parse(JSON.stringify(sheetFromBackup(doc))) as Record<string, JsonValue>;
  const matches = templates.filter(({ data }) => {
    const schema = data.schema;
    return data.status === "approved" && data.name === doc.template.name && data.version === doc.template.version
      && schema !== null && typeof schema === "object" && !Array.isArray(schema)
      && schema.rules_profile_version == null && mechanicallyEquivalentFields(doc.template.fields, schema.fields);
  });
  if (matches.length !== 1) throw new Error("O backup precisa corresponder a um único modelo aprovado desta campanha, com a mesma versão e os mesmos campos.");
  if (doc.effects.length) throw new Error("Este backup contém condições. Restaure-o pelo cofre da versão web; a fila móvel ainda não sincroniza condições.");
  const selected = matches[0]!;
  const schema = selected.data.schema as unknown as SheetTemplate;
  const input = { ...doc.values };
  const nameField = schema.fields.find((field) => field.character_name === true) ?? schema.fields.find((field) => field.id === "nome" && field.kind === "text");
  if (nameField) input[nameField.id] = doc.name;
  const prepared = prepareSheetValues(schema, input, doc.name);
  if (Object.keys(prepared.errors).length) throw new Error(Object.values(prepared.errors)[0]);
  return { template_id: selected.id, name: prepared.name, values: prepared.values };
}
