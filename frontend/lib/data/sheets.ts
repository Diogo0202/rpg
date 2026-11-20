import { anyColumns, cancellable, type Db } from "./db.ts";

/** Fichas e modelos da campanha lidos e gravados direto no Supabase (com RLS). */

/** Colunas da ficha que o editor de fichas carrega e devolve depois de salvar. */
export const EDITOR_SHEET_COLUMNS = "id, name, template_id, owner_id, values, version, effects, portrait_path" as const;

export function sheetTemplateId(db: Db, sheetId: string, campaignId: string) {
  return db.from("character_sheets").select("template_id").eq("id", sheetId).eq("campaign_id", campaignId).single();
}

export function approvedTemplateSchema(db: Db, templateId: string, campaignId: string) {
  return db.from("system_templates").select("schema").eq("id", templateId).eq("campaign_id", campaignId).eq("status", "approved").single();
}

/** Igual a `sheetTemplateId`, mas devolve `data` nulo quando a ficha não está acessível. */
export function findSheetTemplateId(db: Db, sheetId: string, campaignId: string, signal?: AbortSignal) {
  return cancellable(db.from("character_sheets").select("template_id").eq("id", sheetId).eq("campaign_id", campaignId), signal).maybeSingle();
}

export function findApprovedTemplateSchema(db: Db, templateId: string, campaignId: string, signal?: AbortSignal) {
  return cancellable(db.from("system_templates").select("schema").eq("id", templateId).eq("campaign_id", campaignId).eq("status", "approved"), signal).maybeSingle();
}

export function findSheet(db: Db, sheetId: string, campaignId: string, columns: string, signal?: AbortSignal) {
  return cancellable(db.from("character_sheets").select(anyColumns(columns)).eq("id", sheetId).eq("campaign_id", campaignId), signal).maybeSingle();
}

export function listSheetNames(db: Db, campaignId: string, signal?: AbortSignal) {
  return cancellable(db.from("character_sheets").select("id,name").eq("campaign_id", campaignId).order("name"), signal);
}

/** Troca só os valores da ficha, com trava de versão; `data` nulo indica conflito. */
export function replaceSheetValues(db: Db, sheet: { id: string; campaignId: string; version: number }, values: Record<string, unknown>, columns: string, signal?: AbortSignal) {
  return cancellable(db.from("character_sheets")
    .update({ values })
    .eq("id", sheet.id).eq("campaign_id", sheet.campaignId).eq("version", sheet.version)
    .select(anyColumns(columns)), signal).maybeSingle();
}

export function listApprovedTemplates(db: Db, campaignId: string) {
  return db.from("system_templates").select("id, name, version, schema").eq("campaign_id", campaignId).eq("status", "approved").order("name");
}

export function listCampaignSheets(db: Db, campaignId: string) {
  return db.from("character_sheets").select(EDITOR_SHEET_COLUMNS).eq("campaign_id", campaignId).order("name");
}

/** Grava um modelo já validado pela API como aprovado na campanha. */
export function insertApprovedTemplate(db: Db, input: { campaignId: string; ownerId: string; name: string; version: number; schema: unknown }) {
  return db.from("system_templates").insert({
    campaign_id: input.campaignId,
    owner_id: input.ownerId,
    name: input.name,
    version: input.version,
    schema: input.schema,
    status: "approved",
    approved_at: new Date().toISOString(),
  }).select("id, name, version, schema").single();
}

/** Atualiza a ficha só se ela ainda estiver na versão lida; senão devolve `data` nulo. */
export function updateSheetValues(db: Db, sheet: { id: string; campaignId: string; version: number }, patch: { name: string; values: unknown; portrait_path: string | null }) {
  return db.from("character_sheets")
    .update({ ...patch, version: sheet.version + 1, updated_at: new Date().toISOString() })
    .eq("id", sheet.id).eq("campaign_id", sheet.campaignId).eq("version", sheet.version)
    .select(EDITOR_SHEET_COLUMNS).maybeSingle();
}

/** Fichas da barra de sessão, com os efeitos ativos. */
export function listSessionCharacters(db: Db, campaignId: string) {
  return db.from("character_sheets").select("id,name,version,values,effects").eq("campaign_id", campaignId).order("name");
}

/** Grava a lista de efeitos com trava de versão; `data` nulo indica conflito. */
export function saveSheetEffects(db: Db, sheet: { id: string; campaignId: string; version: number }, effects: unknown[]) {
  return db.from("character_sheets")
    .update({ effects }).eq("id", sheet.id).eq("campaign_id", sheet.campaignId).eq("version", sheet.version)
    .select("id,name,version,values,effects").maybeSingle();
}

/** Campanha, modelo e dono de uma ficha (o RLS decide se ela é visível). */
export function sheetContext(db: Db, sheetId: string) {
  return db.from("character_sheets").select("campaign_id,template_id,owner_id").eq("id", sheetId).single();
}

export function templateSchema(db: Db, templateId: string) {
  return db.from("system_templates").select("schema").eq("id", templateId).single();
}

export function findSheetById(db: Db, sheetId: string, columns: string) {
  return db.from("character_sheets").select(anyColumns(columns)).eq("id", sheetId).maybeSingle();
}

export function listPartySheets(db: Db, campaignId: string) {
  return db.from("character_sheets").select("id, name, template_id, values, updated_at, version")
    .eq("campaign_id", campaignId).order("name", { ascending: true });
}

export function listApprovedTemplateSchemas(db: Db, campaignId: string) {
  return db.from("system_templates").select("id, schema").eq("campaign_id", campaignId).eq("status", "approved");
}

/** Anotações privadas do narrador sobre as fichas (o RLS restringe a quem narra). */
export function listSheetSecrets(db: Db, campaignId: string) {
  return db.from("character_sheet_secrets").select("sheet_id, notes").eq("campaign_id", campaignId);
}

export function saveSheetSecret(db: Db, sheetId: string, campaignId: string, notes: string) {
  return db.from("character_sheet_secrets").upsert({ sheet_id: sheetId, campaign_id: campaignId, notes }, { onConflict: "sheet_id" });
}
