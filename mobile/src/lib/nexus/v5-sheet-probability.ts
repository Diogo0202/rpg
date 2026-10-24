import { checkedBaseUrl, type AccessTokenProvider } from "@/lib/mobile-sync/transport.ts";
import type { RollProbabilities, V5ProbabilityComparison } from "@/lib/v5-probability";

export type SheetProbabilityResult = V5ProbabilityComparison & {
  hunger_dice: number;
  modifier_preview: {
    base_pool: number;
    adjusted_pool: number;
    total_delta: number;
    applied: { id: string; label: string; delta: number }[];
  };
};

type RequestOptions = {
  baseUrl: string;
  sheetId: string;
  pool: number;
  difficulty: number;
  willpowerDice: number;
  contextTags: string[];
  getAccessToken: AccessTokenProvider;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
};

function probability(value: unknown): RollProbabilities {
  if (!value || typeof value !== "object") throw new Error("Resposta de probabilidade inválida.");
  const result = value as Record<string, unknown>;
  for (const key of ["success", "messy_critical", "bestial_failure"])
    if (
      typeof result[key] !== "number" ||
      !Number.isFinite(result[key]) ||
      result[key] < 0 ||
      result[key] > 1
    )
      throw new Error("Resposta de probabilidade inválida.");
  return result as RollProbabilities;
}

export async function fetchSheetProbabilities(
  options: RequestOptions,
): Promise<SheetProbabilityResult> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      options.sheetId,
    )
  )
    throw new Error("ID da ficha inválido.");
  const base = checkedBaseUrl(options.baseUrl);
  const token = await options.getAccessToken();
  if (!token) throw new Error("Entre novamente para calcular as condições da ficha.");
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(`${base}/api/v1/v5/sheets/${options.sheetId}/probabilities`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      pool: options.pool,
      difficulty: options.difficulty,
      willpower_dice: options.willpowerDice,
      context_tags: options.contextTags,
    }),
    signal: options.signal,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sessão expirada. Entre novamente.");
    if (response.status === 404) throw new Error("Ficha indisponível para esta conta.");
    throw new Error("A API não conseguiu calcular as condições desta ficha.");
  }
  const body = await response.text();
  if (body.length > 32768) throw new Error("Resposta de probabilidade excede o limite.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Resposta de probabilidade inválida.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Resposta de probabilidade inválida.");
  const result = parsed as Record<string, unknown>;
  const preview = result.modifier_preview as Record<string, unknown> | undefined;
  if (
    !preview ||
    !Array.isArray(preview.applied) ||
    ![
      preview.base_pool,
      preview.adjusted_pool,
      preview.total_delta,
      result.hunger_dice,
      result.reroll_limit,
    ].every((value) => typeof value === "number" && Number.isSafeInteger(value))
  )
    throw new Error("Resposta de probabilidade inválida.");
  if (
    !preview.applied.every(
      (effect) =>
        effect &&
        typeof effect.id === "string" &&
        typeof effect.label === "string" &&
        typeof effect.delta === "number" &&
        Number.isSafeInteger(effect.delta),
    )
  )
    throw new Error("Resposta de probabilidade inválida.");
  return {
    without_reroll: probability(result.without_reroll),
    with_reroll: probability(result.with_reroll),
    reroll_limit: result.reroll_limit as number,
    hunger_dice: result.hunger_dice as number,
    modifier_preview: preview as SheetProbabilityResult["modifier_preview"],
  };
}
