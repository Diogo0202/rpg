import type { FieldValue } from "./sheet-template";

/** One stored snapshot of a sheet (FIC-18), newest first from the API. */
export type SheetVersion = {
  id: number;
  version: number;
  name: string;
  values: Record<string, FieldValue>;
  author_id: string | null;
  author_name: string | null;
  restored_from: number | null;
  created_at: string;
};

export type FieldChange = { fieldId: string; label: string; before: string; after: string };

const STATUS_MESSAGES: Record<number, string> = {
  401: "Sua sessão expirou. Entre novamente.",
  403: "Seu papel nesta campanha não permite esta ação na ficha.",
  404: "A versão ou a ficha não existe mais. Recarregue a lista.",
  409: "A ficha mudou em outra sessão. Recarregue antes de tentar de novo.",
  422: "A versão escolhida não passa pelas regras atuais da ficha.",
  429: "Limite de solicitações atingido. Aguarde antes de tentar novamente.",
};

async function sheetRequest(api: string, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${api.replace(/\/$/, "")}/api/v1${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(STATUS_MESSAGES[response.status] ?? "A API está indisponível. Tente novamente em instantes.");
    }
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("A API demorou além do esperado. Confira a ficha antes de tentar de novo.");
    if (error instanceof TypeError) throw new Error("Não foi possível alcançar a API.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listSheetVersions(api: string, token: string, sheetId: string): Promise<SheetVersion[]> {
  const response = await sheetRequest(api, token, `/sheets/${encodeURIComponent(sheetId)}/versions`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("A API não confirmou o histórico da ficha.");
  return data.filter((item): item is SheetVersion => !!item && typeof item === "object"
    && Number.isInteger((item as SheetVersion).version) && typeof (item as SheetVersion).values === "object");
}

export async function restoreSheetVersion(api: string, token: string, sheetId: string, version: number, expectedVersion: number): Promise<Record<string, unknown>> {
  const response = await sheetRequest(api, token, `/sheets/${encodeURIComponent(sheetId)}/versions/${version}/restore`, {
    method: "POST",
    body: JSON.stringify({ expected_version: expectedVersion }),
  });
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || typeof (data as { version?: unknown }).version !== "number") {
    throw new Error("A API não confirmou a restauração. Recarregue a ficha.");
  }
  return data as Record<string, unknown>;
}

export async function deleteCampaignSheet(api: string, token: string, sheetId: string, expectedVersion: number): Promise<void> {
  await sheetRequest(api, token, `/sheets/${encodeURIComponent(sheetId)}?expected_version=${expectedVersion}`, { method: "DELETE" });
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "vazio";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join(", ") : "vazio";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Field-by-field differences between two snapshots, labelled by the template. */
export function diffSheetVersions(
  before: { name: string; values: Record<string, FieldValue> },
  after: { name: string; values: Record<string, FieldValue> },
  labels: Record<string, string> = {},
): FieldChange[] {
  const changes: FieldChange[] = [];
  if (before.name !== after.name) changes.push({ fieldId: "__name", label: "Nome da ficha", before: before.name, after: after.name });
  const ids = [...new Set([...Object.keys(before.values), ...Object.keys(after.values)])];
  for (const fieldId of ids) {
    const left = display(before.values[fieldId]);
    const right = display(after.values[fieldId]);
    if (left !== right) changes.push({ fieldId, label: labels[fieldId] ?? fieldId, before: left, after: right });
  }
  return changes;
}
