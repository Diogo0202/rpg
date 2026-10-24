import { createClient } from "./supabase/client";

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

/** Authenticated JSON call to the FastAPI backend; errors carry the API's detail text. */
export async function request(path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<unknown> {
  const api = process.env.NEXT_PUBLIC_API_URL;
  if (!api) throw new Error("A API não está configurada.");
  const { data, error } = await createClient().auth.getSession();
  if (error || !data.session) throw new Error("Entre na campanha para alterar a ficha.");
  let response: Response;
  try {
    response = await fetch(`${api.replace(/\/$/, "")}${path}`, {
      method: init.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new Error("Não foi possível alcançar a API.");
  }
  if (response.status === 429) throw new Error("Limite de solicitações atingido. Aguarde antes de tentar novamente.");
  const decoded: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = decoded && typeof decoded === "object" && "detail" in decoded && typeof decoded.detail === "string" ? decoded.detail : "";
    throw new Error(detail ? detail.slice(0, 300) : "A API recusou o ajuste.");
  }
  return decoded;
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
