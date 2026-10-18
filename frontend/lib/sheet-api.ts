import type { FieldValue } from "./sheet-template";

/** Creation always uses the authenticated API and its approved campaign template. */
export async function createCampaignSheet(
  api: string,
  token: string,
  campaignId: string,
  payload: { template_id: string; name: string; values: Record<string, FieldValue> },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${api.replace(/\/$/, "")}/api/v1/campaigns/${encodeURIComponent(campaignId)}/sheets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (response.status === 401) throw new Error("Sua sessão expirou. Entre novamente e tente salvar.");
    if (response.status === 403) throw new Error("Seu papel nesta campanha não permite criar esta ficha.");
    if (response.status === 409) throw new Error("Houve um conflito ao salvar. Confira as fichas da campanha antes de tentar novamente.");
    if (response.status === 429) throw new Error("Limite de solicitações atingido. Aguarde antes de tentar novamente.");
    if (response.status >= 500) throw new Error("A API está indisponível. O preenchimento continua nesta tela.");
    let result: Record<string, unknown>;
    try {
      const decoded: unknown = await response.json();
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("invalid response");
      result = decoded as Record<string, unknown>;
    } catch {
      throw new Error("A resposta do salvamento não pôde ser confirmada. Confira a lista da campanha antes de tentar novamente.");
    }
    if (!response.ok) {
      const detail = typeof result.detail === "string" ? result.detail.slice(0, 500) : "Confira os campos e o modelo aprovado da campanha.";
      throw new Error(`Não foi possível criar a ficha. ${detail}`);
    }
    if (typeof result.id !== "string" || typeof result.name !== "string" || result.template_id !== payload.template_id
      || typeof result.version !== "number" || !Number.isInteger(result.version) || result.version < 1
      || !result.values || typeof result.values !== "object" || Array.isArray(result.values)) {
      throw new Error("A API não confirmou os dados da ficha. Confira a lista da campanha antes de tentar novamente.");
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("O salvamento demorou além do esperado. Confira a lista de fichas antes de tentar novamente.");
    if (error instanceof TypeError) throw new Error("Não foi possível alcançar a API. O preenchimento continua nesta tela.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
