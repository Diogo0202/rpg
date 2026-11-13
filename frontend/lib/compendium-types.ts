export const COMPENDIUM_ENTRY_TYPES = ["discipline", "advantage", "merit", "flaw", "ritual", "spell", "power", "item", "rule"] as const;
export type CompendiumEntryType = (typeof COMPENDIUM_ENTRY_TYPES)[number];

export const COMPENDIUM_TYPE_LABELS: Record<CompendiumEntryType, string> = {
  discipline: "Disciplina", advantage: "Vantagem", merit: "Mérito", flaw: "Defeito", ritual: "Ritual",
  spell: "Magia", power: "Poder", item: "Item", rule: "Regra",
};

/** Tipos que podem ser adicionados às coleções Disciplinas/Vantagens da ficha. */
export const COMPENDIUM_SHEET_INSERTABLE_TYPES: readonly CompendiumEntryType[] = ["discipline", "advantage", "merit", "flaw"];
