export type AiContextRef = { kind: string; id: string };

export function contextBinding(refs: AiContextRef[], hash?: string): { context_refs: AiContextRef[]; context_hash?: string } {
  if (refs.length > 0 && !hash) throw new Error("A prévia do contexto precisa estar atualizada.");
  return { context_refs: refs, ...(refs.length > 0 && hash ? { context_hash: hash } : {}) };
}

export function aiStatusLabel(status: string): string {
  return ({ generating: "Gerando", pending: "Aguardando mestre", approved: "Aprovado", rejected: "Recusado", failed: "Falhou" } as Record<string, string>)[status] ?? status;
}

export function publicationFieldLabel(field: string): string {
  return ({ title: "Título", summary: "Resumo", name: "Nome", description: "Descrição", motivation: "Motivação", voice: "Voz", hook: "Gancho", relationships: "Relações" } as Record<string, string>)[field] ?? field;
}

export const publicationFields = {
  session: ["title", "summary"],
  npc: ["name", "description", "motivation", "voice", "hook", "relationships"],
} as const;

export function buildPublicationFields(kind: "session" | "npc", selected: string[], drafts: Record<string, string>, isNew: boolean): Record<string, unknown> {
  const allowed: readonly string[] = publicationFields[kind];
  if (!selected.length || selected.some((key) => !allowed.includes(key))) throw new Error("Selecione somente campos públicos.");
  const required = kind === "session" ? "title" : "name";
  if (isNew && (!selected.includes(required) || !drafts[required]?.trim())) throw new Error("Escolha um nome público para o novo registro.");
  const fields: Record<string, unknown> = {};
  for (const key of selected) {
    if (key === "relationships") {
      const entries: unknown = JSON.parse(drafts[key] || "[]");
      if (!Array.isArray(entries) || entries.length > 20 || entries.some((entry) => !entry || typeof entry !== "object" || typeof entry.target_id !== "string" || typeof entry.relation_type !== "string" || typeof entry.notes !== "string" || Object.keys(entry).some((property) => !["target_id", "relation_type", "notes"].includes(property)))) throw new Error("Revise as relações antes de publicar.");
      fields[key] = entries;
    } else fields[key] = (drafts[key] ?? "").trim();
  }
  return fields;
}
