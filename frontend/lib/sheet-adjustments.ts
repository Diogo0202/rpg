import { DEFAULT_MESSAGES } from "./api/http.ts";
import { sessionJson, type SessionMessages } from "./api/session.ts";

/**
 * Atomic sheet adjustments: the API forwards deltas to Supabase RPCs, so XP
 * granted by the master and resources spent by the player never overwrite
 * each other the way a whole-values PATCH would.
 */
export type AdjustedSheet = { id: string; name: string; version: number; values: Record<string, unknown> };
export type SheetEvent = {
  id: number;
  kind: "adjust" | "experience" | "meta_currency";
  field_id: string;
  currency_id: string | null;
  delta: number;
  value_before: number;
  value_after: number;
  actor_id: string | null;
  reason: string | null;
  created_at: string;
};

const SHEET_MESSAGES: SessionMessages = {
  status: { 429: DEFAULT_MESSAGES.tooManyRequests },
  rejected: "A API recusou o ajuste.",
  signedOut: "Entre na campanha para alterar a ficha.",
};

/** Authenticated JSON call to the FastAPI backend; errors carry the API's detail text. */
export function request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  return sessionJson(path, init, SHEET_MESSAGES);
}

function adjustedSheet(result: unknown): AdjustedSheet {
  const sheet = result && typeof result === "object" && "sheet" in result ? (result as { sheet: unknown }).sheet : null;
  if (!sheet || typeof sheet !== "object") throw new Error("A API não confirmou a ficha ajustada.");
  const row = sheet as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.version !== "number" || !row.values || typeof row.values !== "object") {
    throw new Error("A API não confirmou a ficha ajustada.");
  }
  return { id: row.id, name: String(row.name ?? ""), version: row.version, values: row.values as Record<string, unknown> };
}

/** Positive amounts are master-only grants; negative amounts spend the owner's XP. */
export async function adjustExperience(sheetId: string, amount: number, reason?: string): Promise<AdjustedSheet> {
  return adjustedSheet(await request(`/api/v1/sheets/${encodeURIComponent(sheetId)}/experience`, { method: "POST", body: { amount, reason: reason || null } }));
}

/** Positive amounts spend the resource; negative amounts recover it. */
export async function spendMetaCurrency(sheetId: string, currencyId: string, amount: number, reason?: string): Promise<AdjustedSheet> {
  return adjustedSheet(await request(
    `/api/v1/sheets/${encodeURIComponent(sheetId)}/meta-currencies/${encodeURIComponent(currencyId)}`,
    { method: "POST", body: { amount, reason: reason || null } },
  ));
}

export type CreationViolation = { rule_id: string; label: string; message: string; fields: string[] };
export type CreationReport = { valid: boolean; field_errors: string[]; violations: CreationViolation[] };

/** Asks the backend whether a wizard draft satisfies the template's limits and creation rules. */
export async function checkCreation(campaignId: string, templateId: string, values: Record<string, unknown>, signal?: AbortSignal): Promise<CreationReport> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const result = await request(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/sheets/validate-creation`, { method: "POST", body: { template_id: templateId, values } });
  const report = result as Partial<CreationReport> | null;
  return { valid: report?.valid === true, field_errors: Array.isArray(report?.field_errors) ? report.field_errors : [], violations: Array.isArray(report?.violations) ? report.violations : [] };
}

export async function listSheetEvents(sheetId: string, limit = 20): Promise<SheetEvent[]> {
  const result = await request(`/api/v1/sheets/${encodeURIComponent(sheetId)}/events?limit=${limit}`, { method: "GET" });
  return Array.isArray(result) ? result as SheetEvent[] : [];
}
