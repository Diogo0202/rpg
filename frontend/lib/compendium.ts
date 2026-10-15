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
};

export const compendiumEntries = entriesJson as CompendiumEntry[];
const searchIndex = new Fuse(compendiumEntries, {
  keys: ["title", "tags", "description"],
  threshold: 0.38,
  ignoreLocation: true,
  includeScore: true,
});

export function searchCompendium(query: string): CompendiumEntry[] {
  const term = query.trim();
  if (!term) return compendiumEntries;
  return searchIndex.search(term).map(({ item }) => item);
}

export function findCompendiumEntry(name: string): CompendiumEntry | undefined {
  const normalized = name.trim().toLocaleLowerCase("pt-BR");
  return compendiumEntries.find((entry) => entry.title.toLocaleLowerCase("pt-BR") === normalized);
}
