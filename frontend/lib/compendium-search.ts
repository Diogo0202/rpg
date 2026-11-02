import Fuse from "fuse.js";

import type { CompendiumEntry } from "./compendium.ts";

const fuseOptions = {
  keys: ["title", "tags", "description", "source.title"],
  threshold: 0.38,
  ignoreLocation: true,
  includeScore: true,
};

export function searchCompendiumEntries(query: string, entries: CompendiumEntry[]): CompendiumEntry[] {
  const term = query.trim();
  if (!term) return entries;
  return new Fuse(entries, fuseOptions).search(term).map(({ item }) => item);
}
