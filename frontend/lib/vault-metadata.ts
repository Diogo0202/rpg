export type VaultMetadata = { level: number | null; tags: string[]; concept: string };
export type VaultSort = "created" | "updated" | "name" | "system";
export type VaultFilter = { query: string; level: string; tag: string; sort: VaultSort };
export type NamedVaultFilter = VaultFilter & { id: string; name: string };

export const EMPTY_VAULT_METADATA: VaultMetadata = { level: null, tags: [], concept: "" };
export const EMPTY_VAULT_FILTER: VaultFilter = { query: "", level: "", tag: "", sort: "updated" };

export function validateVaultMetadata(value: unknown): VaultMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Metadados locais inv\u00e1lidos.");
  const row = value as Record<string, unknown>;
  const level = row.level;
  if (level !== null && (!Number.isInteger(level) || (level as number) < 1 || (level as number) > 100)) throw new Error("O n\u00edvel local deve ficar entre 1 e 100.");
  if (!Array.isArray(row.tags) || row.tags.length > 20 || row.tags.some((tag) => typeof tag !== "string" || tag.length > 32 || !tag.trim())) throw new Error("As tags locais devem ter at\u00e9 32 caracteres, com limite de 20 tags.");
  if (typeof row.concept !== "string" || row.concept.length > 500) throw new Error("O conceito local deve ter at\u00e9 500 caracteres.");
  const tags = [...new Map((row.tags as string[]).map((tag) => [tag.trim().toLocaleLowerCase("pt-BR"), tag.trim()])).values()];
  if (tags.length > 20) throw new Error("O limite \u00e9 de 20 tags locais.");
  return { level: level as number | null, tags, concept: row.concept.trim() };
}

export function validateNamedVaultFilters(value: unknown): NamedVaultFilter[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("A lista de filtros salvos est\u00e1 inv\u00e1lida ou excede 20 itens.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Um filtro salvo est\u00e1 inv\u00e1lido.");
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || ids.has(row.id) || typeof row.name !== "string" || !row.name.trim() || row.name.length > 48 || typeof row.query !== "string" || row.query.length > 120 || typeof row.level !== "string" || !/^$|^([1-9]|[1-9][0-9]|100)$/.test(row.level) || typeof row.tag !== "string" || row.tag.length > 32 || !["created", "updated", "name", "system"].includes(String(row.sort))) throw new Error("Os dados de um filtro salvo est\u00e3o inv\u00e1lidos.");
    ids.add(row.id);
    return { id: row.id, name: row.name.trim(), query: row.query, level: row.level, tag: row.tag, sort: row.sort as VaultSort };
  });
}

export function parseTagsInput(value: string): string[] {
  const tags = value.split(/[\n,]/).map((tag) => tag.trim()).filter(Boolean);
  if (tags.length > 20 || tags.some((tag) => tag.length > 32)) throw new Error("Informe no m\u00e1ximo 20 tags, com at\u00e9 32 caracteres cada.");
  return validateVaultMetadata({ ...EMPTY_VAULT_METADATA, tags }).tags;
}

export type VaultSearchRecord = { name: string; system: string; concept?: string; tags?: string[]; level?: number | null; createdAt: string; updatedAt: string };

export function filterAndSortVault<T extends VaultSearchRecord>(rows: T[], filter: VaultFilter): T[] {
  const term = filter.query.trim().toLocaleLowerCase("pt-BR");
  const tag = filter.tag.trim().toLocaleLowerCase("pt-BR");
  const level = filter.level ? Number(filter.level) : null;
  return rows.filter((row) => {
    const haystack = [row.name, row.system, row.concept ?? "", ...(row.tags ?? [])].join(" ").toLocaleLowerCase("pt-BR");
    return (!term || haystack.includes(term)) && (level === null || row.level === level) && (!tag || (row.tags ?? []).some((item) => item.toLocaleLowerCase("pt-BR") === tag));
  }).sort((a, b) => {
    if (filter.sort === "name") return a.name.localeCompare(b.name, "pt-BR");
    if (filter.sort === "system") return a.system.localeCompare(b.system, "pt-BR") || a.name.localeCompare(b.name, "pt-BR");
    if (filter.sort === "created") return b.createdAt.localeCompare(a.createdAt);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function validateVaultFilter(value: unknown): VaultFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Os filtros do cofre estao invalidos.");
  const row = value as Record<string, unknown>;
  if (typeof row.query !== "string" || row.query.length > 120 || typeof row.level !== "string" || !/^$|^([1-9]|[1-9][0-9]|100)$/.test(row.level) || typeof row.tag !== "string" || row.tag.length > 32 || !["created", "updated", "name", "system"].includes(String(row.sort))) throw new Error("Os filtros do cofre estao invalidos.");
  return { query: row.query, level: row.level, tag: row.tag, sort: row.sort as VaultSort };
}
