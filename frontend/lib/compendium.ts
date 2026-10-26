import Fuse from "fuse.js";

import entriesJson from "../data/compendium-homebrew.json";

export type CompendiumEntry = {
  id: string;
  title: string;
  type: "discipline" | "advantage";
  level: 0 | 1 | 2 | 3 | 4 | 5;
  tags: string[];
  cost: string;
  pool: string;
  duration: string;
  description: string;
  source: { title: string; page?: number; kind: "homebrew" | "licensed" };
  /** local = example bundled with the app; campaign = approved by the campaign narrator. */
  origin?: "local" | "campaign";
};

export const compendiumEntries = (entriesJson as CompendiumEntry[]).map((entry) => ({ ...entry, origin: "local" as const }));
const fuseOptions = {
  keys: ["title", "tags", "description"],
  threshold: 0.38,
  ignoreLocation: true,
  includeScore: true,
};
const searchIndex = new Fuse(compendiumEntries, fuseOptions);

export function searchCompendium(query: string, entries: CompendiumEntry[] = compendiumEntries): CompendiumEntry[] {
  const term = query.trim();
  if (!term) return entries;
  const index = entries === compendiumEntries ? searchIndex : new Fuse(entries, fuseOptions);
  return index.search(term).map(({ item }) => item);
}

export function findCompendiumEntry(name: string, entries: CompendiumEntry[] = compendiumEntries): CompendiumEntry | undefined {
  const normalized = name.trim().toLocaleLowerCase("pt-BR");
  return entries.find((entry) => entry.title.toLocaleLowerCase("pt-BR") === normalized);
}
