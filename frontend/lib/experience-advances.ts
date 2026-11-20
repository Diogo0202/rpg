import { request, type AdjustedSheet } from "./sheet-adjustments";

/** EXP-02: compra de avanço com XP pelas RPCs; o custo vem sempre do servidor. */
export type AdvanceStatus = "pending" | "applied" | "rejected" | "refunded";
export type CharacterAdvance = {
  id: string;
  actor_id: string | null;
  system_key: string;
  trait: string;
  category: string;
  item_name: string | null;
  item_value: string | null;
  from_level: number;
  to_level: number;
  cost: number;
  status: AdvanceStatus;
  xp_before: number | null;
  xp_after: number | null;
  reason: string | null;
  review_note: string | null;
  created_at: string;
};
export type ServerQuote = {
  category: string; label: string; from_level: number; to_level: number; cost: number;
  xp_available: number | null; sheet_version: number; requires_approval: boolean; needs_book_check: boolean;
};
export type AdvanceRequest = { trait: string; target_level: number; item_name?: string | null };
export type AdvanceResult = { advance: CharacterAdvance; sheet: AdjustedSheet; replayed: boolean };

function sheetOf(raw: unknown): AdjustedSheet {
  const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!row || typeof row.id !== "string" || typeof row.version !== "number" || !row.values || typeof row.values !== "object") {
    throw new Error("A API não confirmou a ficha.");
  }
  return { id: row.id, name: String(row.name ?? ""), version: row.version, values: row.values as Record<string, unknown> };
}

function resultOf(raw: unknown): AdvanceResult {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (!body.advance || typeof body.advance !== "object") throw new Error("A API não confirmou o avanço.");
  return { advance: body.advance as CharacterAdvance, sheet: sheetOf(body.sheet), replayed: body.replayed === true };
}

const sheetPath = (sheetId: string) => `/api/v1/sheets/${encodeURIComponent(sheetId)}`;

export async function quoteServerAdvance(sheetId: string, advance: AdvanceRequest): Promise<ServerQuote> {
  return await request(`${sheetPath(sheetId)}/advances/quote`, { method: "POST", body: { ...advance, item_name: advance.item_name || null } }) as ServerQuote;
}

/** Reuse the same operationId when retrying after a lost reply: the server replays instead of charging twice. */
export async function purchaseAdvance(
  sheetId: string, advance: AdvanceRequest, expectedVersion: number, operationId: string, reason?: string,
): Promise<AdvanceResult> {
  return resultOf(await request(`${sheetPath(sheetId)}/advances`, {
    method: "POST",
    body: { ...advance, item_name: advance.item_name || null, expected_version: expectedVersion, operation_id: operationId, reason: reason || null },
  }));
}

export async function listAdvances(sheetId: string, limit = 50): Promise<CharacterAdvance[]> {
  const result = await request(`${sheetPath(sheetId)}/advances?limit=${limit}`, { method: "GET" });
  return Array.isArray(result) ? result as CharacterAdvance[] : [];
}

export async function reviewAdvance(advanceId: string, approve: boolean, note?: string): Promise<AdvanceResult> {
  return resultOf(await request(`/api/v1/advances/${encodeURIComponent(advanceId)}/review`, { method: "POST", body: { approve, note: note || null } }));
}

export async function refundAdvance(advanceId: string, note?: string): Promise<AdvanceResult> {
  return resultOf(await request(`/api/v1/advances/${encodeURIComponent(advanceId)}/refund`, { method: "POST", body: { note: note || null } }));
}

export async function getExperienceSettings(campaignId: string): Promise<{ requires_approval: boolean }> {
  const result = await request(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/experience-settings`, { method: "GET" }) as { requires_approval?: unknown };
  return { requires_approval: result?.requires_approval === true };
}

export async function setExperienceApproval(campaignId: string, requiresApproval: boolean): Promise<{ requires_approval: boolean }> {
  const response = await request(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/experience-settings`, { method: "POST", body: { requires_approval: requiresApproval } });
  return { requires_approval: (response as { requires_approval?: unknown })?.requires_approval === true };
}
