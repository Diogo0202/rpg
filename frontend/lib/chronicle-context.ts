// DRA-05: monta o contexto opcional `chronicle` que as rotas de rolagem aceitam
// e interpreta o header X-Chronicle-Activity da resposta. Funções puras, sem rede.

export type ChronicleContext = {
  sheet_id: string;
  campaign_id?: string;
  trait_ids: string[];
  roll_key: string;
};

export type ChronicleActivityStatus =
  | "recorded" | "duplicate" | "limit_reached" | "no_traits" | "not_in_campaign"
  | "not_allowed" | "unapproved_template" | "error";

export const CHRONICLE_ACTIVITY_HEADER = "X-Chronicle-Activity";

const STATUSES: ReadonlySet<string> = new Set<ChronicleActivityStatus>([
  "recorded", "duplicate", "limit_reached", "no_traits", "not_in_campaign",
  "not_allowed", "unapproved_template", "error",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRAITS = 50;
const MAX_TRAIT_LENGTH = 80;
const MAX_ROLL_KEY = 120;

export function newRollKey(prefix = "roll"): string {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${id}`.slice(0, MAX_ROLL_KEY);
}

/**
 * Devolve o contexto da crônica ou `undefined` quando não há ficha válida.
 * Tudo que o servidor rejeitaria (422) é descartado aqui, para nunca derrubar a rolagem.
 */
export function buildChronicleContext(input: {
  sheetId?: string | null;
  campaignId?: string | null;
  traitIds?: readonly (string | null | undefined)[];
  rollKey: string;
}): ChronicleContext | undefined {
  const sheetId = input.sheetId?.trim();
  if (!sheetId || !UUID.test(sheetId)) return undefined;
  const rollKey = input.rollKey.trim();
  if (!rollKey || rollKey.length > MAX_ROLL_KEY) return undefined;
  const traits: string[] = [];
  for (const raw of input.traitIds ?? []) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || id.length > MAX_TRAIT_LENGTH || traits.includes(id)) continue;
    traits.push(id);
    if (traits.length === MAX_TRAITS) break;
  }
  const context: ChronicleContext = { sheet_id: sheetId, trait_ids: traits, roll_key: rollKey };
  const campaignId = input.campaignId?.trim();
  if (campaignId && UUID.test(campaignId)) context.campaign_id = campaignId;
  return context;
}

/** Acrescenta `chronicle` ao corpo só quando há contexto. */
export function withChronicle<T extends Record<string, unknown>>(payload: T, context: ChronicleContext | undefined): T & { chronicle?: ChronicleContext } {
  return context ? { ...payload, chronicle: context } : payload;
}

export function parseChronicleActivity(header: string | null | undefined): ChronicleActivityStatus | null {
  const value = header?.trim().toLowerCase();
  return value && STATUSES.has(value) ? value as ChronicleActivityStatus : null;
}

/** Texto discreto para a interface; só o registro efetivo ganha indicador. */
export function chronicleActivityLabel(status: ChronicleActivityStatus | null): string | null {
  return status === "recorded" ? "registrado na crônica" : null;
}
