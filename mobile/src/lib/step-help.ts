import { HUNTER_STEP_HELP } from "./hunter-creation-data.ts";
import { SOTDL_STEP_HELP } from "./sotdl-creation-data.ts";
import { DEMON_STEP_HELP } from "./demon-fallen-creation-data.ts";

/** Per-system help shown above a creation step; systems without an entry show none. */
export const STEP_HELP_BY_SYSTEM: Record<string, Record<string, string>> = {
  hunter: HUNTER_STEP_HELP,
  "shadow-demon-lord": SOTDL_STEP_HELP,
  "demon-the-fallen": DEMON_STEP_HELP,
};

export function stepHelp(systemKey: string | null | undefined, step: string): string | undefined {
  return systemKey ? STEP_HELP_BY_SYSTEM[systemKey]?.[step] : undefined;
}
