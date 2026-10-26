import type { CompendiumEntry } from "./compendium.ts";

/** Row of public.campaign_compendium_entries as returned by Supabase (RLS filters per campaign). */
export type CampaignCompendiumRow = {
  id: string;
  campaign_id: string;
  proposed_by: string;
  title: string;
  entry_type: "discipline" | "advantage";
  level: number;
  tags: string[];
  cost: string;
  pool: string;
  duration: string;
  description: string;
  source_title: string;
  source_page: number | null;
  source_kind: "homebrew" | "licensed";
  status: "pending" | "approved" | "rejected";
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export const CAMPAIGN_COMPENDIUM_COLUMNS =
  "id,campaign_id,proposed_by,title,entry_type,level,tags,cost,pool,duration,description,source_title,source_page,source_kind,status,review_note,reviewed_at,created_at,updated_at";

export type CompendiumProposalDraft = {
  title: string;
  type: "discipline" | "advantage";
  level: string;
  tags: string;
  cost: string;
  pool: string;
  duration: string;
  description: string;
  sourceTitle: string;
  sourcePage: string;
  sourceKind: "homebrew" | "licensed";
};

export type CompendiumProposalPayload = {
  p_campaign_id: string;
  p_title: string;
  p_entry_type: "discipline" | "advantage";
  p_level: number;
  p_tags: string[];
  p_cost: string;
  p_pool: string;
  p_duration: string;
  p_description: string;
  p_source_title: string;
  p_source_page: number | null;
  p_source_kind: "homebrew" | "licensed";
};

export function emptyProposalDraft(): CompendiumProposalDraft {
  return { title: "", type: "discipline", level: "1", tags: "", cost: "", pool: "", duration: "", description: "", sourceTitle: "", sourcePage: "", sourceKind: "homebrew" };
}

const normalizeTitle = (value: string) => value.trim().toLocaleLowerCase("pt-BR");

export function rowToCompendiumEntry(row: CampaignCompendiumRow): CompendiumEntry {
  const level = Math.min(5, Math.max(0, Math.trunc(Number(row.level) || 0))) as CompendiumEntry["level"];
  return {
    id: `campaign-${row.id}`,
    title: row.title,
    type: row.entry_type,
    level,
    tags: Array.isArray(row.tags) ? row.tags : [],
    cost: row.cost || "Não informado",
    pool: row.pool || "Não informado",
    duration: row.duration || "Não informado",
    description: row.description,
    source: { title: row.source_title, ...(row.source_page ? { page: row.source_page } : {}), kind: row.source_kind },
    origin: "campaign",
  };
}

/**
 * Approved campaign entries come first and replace a local homebrew entry with the same title:
 * the narrator's reviewed version is authoritative for the table.
 */
export function mergeCompendiumEntries(local: CompendiumEntry[], rows: CampaignCompendiumRow[]): CompendiumEntry[] {
  const campaign = rows.filter((row) => row.status === "approved").map(rowToCompendiumEntry)
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
  const taken = new Set(campaign.map((entry) => normalizeTitle(entry.title)));
  return [...campaign, ...local.filter((entry) => !taken.has(normalizeTitle(entry.title))).map((entry) => ({ ...entry, origin: entry.origin ?? "local" as const }))];
}

export function originLabel(entry: CompendiumEntry): string {
  const where = entry.origin === "campaign" ? "Campanha (revisado pelo narrador)" : "Acervo local de exemplos";
  const page = entry.source.page ? `, página ${entry.source.page}` : "";
  const kind = entry.source.kind === "licensed" ? "licenciado" : "homebrew";
  return `${where} · ${entry.source.title}${page} (${kind})`;
}

export function parseCompendiumTags(value: string): string[] {
  const result: string[] = [];
  for (const raw of value.split(",")) {
    const tag = raw.trim().toLocaleLowerCase("pt-BR");
    if (tag && !result.includes(tag)) result.push(tag);
  }
  return result;
}

export function validateCompendiumProposal(campaignId: string, draft: CompendiumProposalDraft): { payload?: CompendiumProposalPayload; errors: string[] } {
  const errors: string[] = [];
  const title = draft.title.trim();
  const description = draft.description.trim();
  const sourceTitle = draft.sourceTitle.trim();
  const level = Number(draft.level);
  const tags = parseCompendiumTags(draft.tags);
  const pageText = draft.sourcePage.trim();
  const page = pageText ? Number(pageText) : null;
  if (!title || title.length > 120) errors.push("Informe um nome com até 120 caracteres.");
  if (draft.type !== "discipline" && draft.type !== "advantage") errors.push("Escolha Disciplina ou Vantagem.");
  if (!Number.isInteger(level) || level < 0 || level > 5) errors.push("O nível deve ser um inteiro de 0 a 5.");
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) errors.push("Use até 20 etiquetas de até 40 caracteres.");
  for (const [label, value] of [["Custo", draft.cost], ["Parada", draft.pool], ["Duração", draft.duration]] as const) {
    if (value.trim().length > 240) errors.push(`${label} aceita até 240 caracteres.`);
  }
  if (!description || description.length > 4000) errors.push("Escreva uma descrição própria com até 4000 caracteres.");
  if (!sourceTitle || sourceTitle.length > 240) errors.push("Informe a fonte (até 240 caracteres).");
  if (page !== null && (!Number.isInteger(page) || page < 1 || page > 5000)) errors.push("A página deve ser um inteiro entre 1 e 5000.");
  if (draft.sourceKind !== "homebrew" && draft.sourceKind !== "licensed") errors.push("Escolha a origem da fonte.");
  if (errors.length) return { errors };
  return {
    errors,
    payload: {
      p_campaign_id: campaignId,
      p_title: title,
      p_entry_type: draft.type,
      p_level: level,
      p_tags: tags,
      p_cost: draft.cost.trim(),
      p_pool: draft.pool.trim(),
      p_duration: draft.duration.trim(),
      p_description: description,
      p_source_title: sourceTitle,
      p_source_page: page,
      p_source_kind: draft.sourceKind,
    },
  };
}

export function splitReviewRows(rows: CampaignCompendiumRow[], viewerId?: string) {
  return {
    pending: rows.filter((row) => row.status === "pending"),
    mine: viewerId ? rows.filter((row) => row.proposed_by === viewerId && row.status !== "approved") : [],
  };
}
