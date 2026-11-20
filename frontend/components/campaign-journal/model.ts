/** Tipos, rótulos e textos do diário da campanha. Sem React e sem Supabase. */

export type SessionStatus = "planned" | "played" | "archived";
export type EventStatus = "planned" | "active" | "resolved" | "failed" | "consequence";

export type CampaignSession = {
  id: string;
  campaign_id: string;
  sequence: number;
  title: string;
  summary: string;
  status: SessionStatus;
  played_on: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignFaction = {
  id: string;
  campaign_id: string;
  name: string;
  description: string;
  goal: string;
  tension: number;
  limit: number;
  consequence: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type CampaignEvent = {
  id: string;
  campaign_id: string;
  session_id: string | null;
  faction_id: string | null;
  title: string;
  description: string;
  occurred_on: string;
  status: EventStatus;
  created_at: string;
  updated_at: string;
};

export type SessionDraft = { id: string | null; sequence: string; title: string; summary: string; status: SessionStatus; played_on: string };
export type FactionDraft = { id: string | null; name: string; description: string; goal: string; tension: string; limit: string; consequence: string };
export type EventDraft = { id: string | null; session_id: string; faction_id: string; title: string; description: string; occurred_on: string; status: EventStatus };

export const SESSION_STATUS_LABELS: Record<SessionStatus, string> = {
  planned: "Planejada",
  played: "Jogada",
  archived: "Arquivada",
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  planned: "Planejado",
  active: "Ativo",
  resolved: "Resolvido",
  failed: "Falhou",
  consequence: "Consequência",
};

export const LINKABLE_KINDS = ["npc", "item", "quest", "location"] as const;
export type LinkableKind = (typeof LINKABLE_KINDS)[number];
export type LinkKind = "consequence" | "involves" | "reward" | "setting";
export type LinkableEntity = { id: string; kind: LinkableKind; name: string };
export type EventEntityLink = { id: string; event_id: string; entity_id: string; link_kind: LinkKind; notes: string };
export type LinkDraft = { entity_id: string; link_kind: LinkKind };

export const ENTITY_KIND_LABELS: Record<LinkableKind, string> = { npc: "NPC", item: "Item", quest: "Missão", location: "Local" };
export const LINK_KIND_LABELS: Record<LinkKind, string> = { consequence: "Consequência", involves: "Envolve", reward: "Recompensa", setting: "Cenário" };

export function dateLabel(value: string | null): string {
  if (!value) return "Sem data";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "Data inválida" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(date);
}

export function safePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "campanha";
}

function escapeMarkdown(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([*_`])/g, "\\$1");
}

export function emptySession(sequence: number): SessionDraft {
  return { id: null, sequence: String(sequence), title: "", summary: "", status: "planned", played_on: "" };
}

export function emptyFaction(): FactionDraft {
  return { id: null, name: "", description: "", goal: "", tension: "0", limit: "6", consequence: "" };
}

export function emptyEvent(): EventDraft {
  return { id: null, session_id: "", faction_id: "", title: "", description: "", occurred_on: new Date().toISOString().slice(0, 10), status: "planned" };
}

export function sessionDraftOf(item: CampaignSession): SessionDraft {
  return { id: item.id, sequence: String(item.sequence), title: item.title, summary: item.summary, status: item.status, played_on: item.played_on ?? "" };
}

export function factionDraftOf(item: CampaignFaction): FactionDraft {
  return { id: item.id, name: item.name, description: item.description, goal: item.goal, tension: String(item.tension), limit: String(item.limit), consequence: item.consequence };
}

export function eventDraftOf(item: CampaignEvent): EventDraft {
  return { id: item.id, session_id: item.session_id ?? "", faction_id: item.faction_id ?? "", title: item.title, description: item.description, occurred_on: item.occurred_on, status: item.status };
}

export type EventFilters = { query: string; session: string; faction: string; status: string };

export function filterEvents(events: CampaignEvent[], filters: EventFilters): CampaignEvent[] {
  const needle = filters.query.trim().toLocaleLowerCase("pt-BR");
  return events.filter((item) => {
    if (filters.session && item.session_id !== filters.session) return false;
    if (filters.faction && item.faction_id !== filters.faction) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.query) {
      const searchable = `${item.title} ${item.description}`.toLocaleLowerCase("pt-BR");
      if (!searchable.includes(needle)) return false;
    }
    return true;
  });
}

export type JournalSnapshot = { sessions: CampaignSession[]; factions: CampaignFaction[]; events: CampaignEvent[]; entityLinks: EventEntityLink[] };

export function journalJson(campaignId: string, journal: JournalSnapshot, exportedAt: string): string {
  return JSON.stringify({ campaign_id: campaignId, exported_at: exportedAt, sessions: journal.sessions, factions: journal.factions, events: journal.events, entity_links: journal.entityLinks }, null, 2);
}

export function journalMarkdown(campaignId: string, { sessions, factions, events }: JournalSnapshot): string {
  const sessionNames = new Map(sessions.map((item) => [item.id, `Sessão ${item.sequence}: ${item.title}`]));
  const factionNames = new Map(factions.map((item) => [item.id, item.name]));
  const lines = ["# Diário da campanha", "", `ID da campanha: ${campaignId}`, "", "## Sessões", ""];
  if (!sessions.length) lines.push("Nenhuma sessão registrada.", "");
  for (const item of sessions) {
    lines.push(`### Sessão ${item.sequence}: ${escapeMarkdown(item.title)}`, "", `Status: ${SESSION_STATUS_LABELS[item.status]}`, `Data: ${dateLabel(item.played_on)}`, "", item.summary || "Sem resumo registrado.", "");
  }
  lines.push("## Facções", "");
  if (!factions.length) lines.push("Nenhuma facção registrada.", "");
  for (const item of factions) {
    lines.push(`### ${escapeMarkdown(item.name)}`, "", `Tensão: ${item.tension} de ${item.limit}${item.tension >= item.limit ? " (Ruptura)" : ""}`, "", `Descrição: ${item.description || "Sem descrição registrada."}`, `Objetivo: ${item.goal || "Sem objetivo registrado."}`, `Consequência: ${item.consequence || "Sem consequência registrada."}`, "");
  }
  lines.push("## Linha do tempo", "");
  if (!events.length) lines.push("Nenhum evento registrado.", "");
  for (const item of events) {
    lines.push(`### ${dateLabel(item.occurred_on)} · ${escapeMarkdown(item.title)}`, "", `Status: ${EVENT_STATUS_LABELS[item.status]}`, `Sessão: ${item.session_id ? sessionNames.get(item.session_id) ?? "Sessão removida" : "Sem vínculo"}`, `Facção: ${item.faction_id ? factionNames.get(item.faction_id) ?? "Facção removida" : "Sem vínculo"}`, "", item.description || "Sem descrição registrada.", "");
  }
  return lines.join("\n");
}
