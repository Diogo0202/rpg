import { apiSend, objectBody } from "./api/http.ts";

export type MarketplaceCard = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  author_name: string;
  automation_level: string;
  dependencies: string[];
  updated_at: string;
  usage_count: number;
  likes: number;
  dislikes: number;
};

export type PublicMarketplaceResult = { items: MarketplaceCard[]; error: string | null };

function isCard(value: unknown): value is MarketplaceCard {
  if (!value || typeof value !== "object") return false;
  const card = value as Partial<MarketplaceCard>;
  return typeof card.id === "string" && typeof card.name === "string" && typeof card.description === "string"
    && Array.isArray(card.tags) && card.tags.every((tag) => typeof tag === "string")
    && typeof card.author_name === "string" && typeof card.automation_level === "string"
    && Array.isArray(card.dependencies) && card.dependencies.every((dependency) => typeof dependency === "string")
    && typeof card.updated_at === "string" && Number.isFinite(card.usage_count)
    && Number.isFinite(card.likes) && Number.isFinite(card.dislikes);
}

export async function getPublicMarketplaceItems(
  api = process.env.NEXT_PUBLIC_API_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<PublicMarketplaceResult> {
  if (!api?.trim()) return { items: [], error: "A API pública não está configurada nesta instalação." };
  try {
    const response = await apiSend(api, "/api/v1/marketplace/systems", {
      headers: { Accept: "application/json" }, cache: "no-store", credentials: "omit", timeoutMs: 5000,
    }, { timeout: "A lista pública demorou além do esperado. Tente buscar novamente." }, fetchImpl);
    if (!response.parsed) throw new Error("A API enviou uma resposta que não pôde ser lida.");
    if (!response.ok) throw new Error("A lista pública está temporariamente indisponível.");
    const value = objectBody(response.body);
    const items = Array.isArray(value.items) ? value.items.filter(isCard) : null;
    if (!items) throw new Error("A API enviou uma lista de modelos inválida.");
    return { items, error: null };
  } catch (error) {
    return { items: [], error: error instanceof Error ? error.message : "Não foi possível carregar os modelos." };
  }
}
