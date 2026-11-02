import entriesJson from "../data/compendium-homebrew.json";
import { searchCompendiumEntries } from "./compendium-search.ts";

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
export function searchCompendium(query: string, entries: CompendiumEntry[] = compendiumEntries): CompendiumEntry[] {
  return searchCompendiumEntries(query, entries);
}

export function findCompendiumEntry(name: string, entries: CompendiumEntry[] = compendiumEntries): CompendiumEntry | undefined {
  const normalized = name.trim().toLocaleLowerCase("pt-BR");
  return entries.find((entry) => entry.title.toLocaleLowerCase("pt-BR") === normalized);
}
