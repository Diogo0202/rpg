export type ReviewField = {
  id: string;
  label: string;
  kind: string;
  required?: boolean;
  options?: string[];
  expression?: string | null;
  [key: string]: unknown;
};

export type ReviewTemplate = {
  name: string;
  version: number;
  fields: ReviewField[];
  [key: string]: unknown;
};

export type PendingMarketplaceImport = {
  id: string;
  name: string;
  version: number;
  schema: ReviewTemplate;
  source_name: string;
  source_status: string;
};

const fieldKinds = new Set(["text", "number", "select", "checkbox", "collection", "formula", "roll"]);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function reviewTemplate(value: unknown): value is ReviewTemplate {
  if (!record(value) || typeof value.name !== "string" || !Number.isSafeInteger(value.version)
      || Number(value.version) < 1 || !Array.isArray(value.fields) || !value.fields.length) return false;
  const ids = new Set<string>();
  return value.fields.every((field: unknown) => {
    if (!record(field) || typeof field.id !== "string" || !field.id || ids.has(field.id)
        || typeof field.label !== "string" || typeof field.kind !== "string" || !fieldKinds.has(field.kind)
        || (field.required !== undefined && typeof field.required !== "boolean")
        || (field.options !== undefined && (!Array.isArray(field.options) || !field.options.every((option: unknown) => typeof option === "string")))
        || (field.expression !== undefined && field.expression !== null && typeof field.expression !== "string")) return false;
    ids.add(field.id);
    return true;
  });
}

/** Preserve the exact reviewed JSON. The approval RPC compares this snapshot. */
export function parsePendingMarketplaceImports(value: unknown): PendingMarketplaceImport[] {
  if (!Array.isArray(value)) throw new Error("A lista de modelos em revisão veio em formato inválido.");
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!record(item) || typeof item.id !== "string" || !uuid.test(item.id) || ids.has(item.id)
        || typeof item.name !== "string" || !Number.isSafeInteger(item.version) || Number(item.version) < 1
        || typeof item.source_name !== "string" || typeof item.source_status !== "string"
        || !reviewTemplate(item.schema)) throw new Error("Um modelo importado tem dados inválidos. Atualize a lista antes de aprovar.");
    ids.add(item.id);
    return item as PendingMarketplaceImport;
  });
}

export function canApproveMarketplaceImport(item: PendingMarketplaceImport, reviewed: boolean): boolean {
  return reviewed && item.source_status === "published";
}

export function marketplaceApprovalError(error: unknown): string {
  const code = record(error) ? error.code : undefined;
  if (code === "22023") return "O modelo mudou durante a revisão. Atualize a lista e confira a nova versão antes de aprovar.";
  if (code === "42501") return "A aprovação foi recusada. Confira sua permissão e se a publicação continua disponível.";
  return "Não foi possível confirmar a aprovação. Atualize a lista antes de tentar novamente.";
}
