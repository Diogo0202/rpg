import type { FieldValue } from "../../shared/rules/sheet-template";
import { apiSend, ApiError, errorMessage, objectBody, type ApiMessages } from "./api/http.ts";

const CREATE_MESSAGES: ApiMessages = {
  status: {
    401: "Sua sessão expirou. Entre novamente e tente salvar.",
    403: "Seu papel nesta campanha não permite criar esta ficha.",
    409: "Houve um conflito ao salvar. Confira as fichas da campanha antes de tentar novamente.",
    429: "Limite de solicitações atingido. Aguarde antes de tentar novamente.",
  },
  unavailable: "A API está indisponível. O preenchimento continua nesta tela.",
  detailPrefix: "Não foi possível criar a ficha. ",
  rejected: "Não foi possível criar a ficha. Confira os campos e o modelo aprovado da campanha.",
  network: "Não foi possível alcançar a API. O preenchimento continua nesta tela.",
  timeout: "O salvamento demorou além do esperado. Confira a lista de fichas antes de tentar novamente.",
};

/** Creation always uses the authenticated API and its approved campaign template. */
export async function createCampaignSheet(
  api: string,
  token: string,
  campaignId: string,
  payload: { template_id: string; name: string; values: Record<string, FieldValue>; portrait_path?: string },
): Promise<Record<string, unknown>> {
  const response = await apiSend(api, `/api/v1/campaigns/${encodeURIComponent(campaignId)}/sheets`, {
    method: "POST", token, body: payload, timeoutMs: 12000,
  }, CREATE_MESSAGES);
  const fixed = CREATE_MESSAGES.status?.[response.status] ?? (response.status >= 500 ? CREATE_MESSAGES.unavailable : undefined);
  if (fixed) throw new ApiError(fixed, "http", response.status);
  if (!response.parsed || objectBody(response.body) !== response.body) {
    throw new ApiError("A resposta do salvamento não pôde ser confirmada. Confira a lista da campanha antes de tentar novamente.", "http", response.status);
  }
  if (!response.ok) throw new ApiError(errorMessage(response, CREATE_MESSAGES), "http", response.status);
  const result = response.body as Record<string, unknown>;
  if (typeof result.id !== "string" || typeof result.name !== "string" || result.template_id !== payload.template_id
    || typeof result.version !== "number" || !Number.isInteger(result.version) || result.version < 1
    || !result.values || typeof result.values !== "object" || Array.isArray(result.values)) {
    throw new ApiError("A API não confirmou os dados da ficha. Confira a lista da campanha antes de tentar novamente.", "http", response.status);
  }
  return result;
}
