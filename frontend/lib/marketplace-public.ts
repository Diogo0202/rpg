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
  request: typeof fetch = fetch,
): Promise<PublicMarketplaceResult> {
  if (!api?.trim()) return { items: [], error: "A API pública não está configurada nesta instalação." };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request(`${api.replace(/\/$/, "")}/api/v1/marketplace/systems`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    let value: unknown;
    try { value = await response.json(); } catch { throw new Error("A API enviou uma resposta que não pôde ser lida."); }
    if (!response.ok) throw new Error("A lista pública está temporariamente indisponível.");
    const items = value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items.filter(isCard) : null;
    if (!items) throw new Error("A API enviou uma lista de modelos inválida.");
    return { items, error: null };
  } catch (error) {
    const message = controller.signal.aborted
      ? "A lista pública demorou além do esperado. Tente buscar novamente."
      : error instanceof Error ? error.message : "Não foi possível carregar os modelos.";
    return { items: [], error: message };
  } finally {
    clearTimeout(timeout);
  }
}
