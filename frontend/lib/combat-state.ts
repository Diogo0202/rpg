/**
 * Combat (scene) state stored in public.combat_sessions.state and helpers to change it.
 * The participant list lives inside that jsonb; every write is guarded by combat_sessions.version.
 */

export type ParticipantKind = "pc" | "npc" | "enemy";
export type CombatParticipant = {
  id: string;
  name: string;
  initiative: number;
  /** Optional origin, preserved across saves. */
  kind?: ParticipantKind;
  /** Optional world_entities.id the participant came from. */
  entity_id?: string;
  /** Other keys (health, health_max, origin…) are preserved verbatim. */
  [extra: string]: unknown;
};
export type CombatState = { round: number; turn: number; participants: CombatParticipant[]; paused: boolean };
export type NewCombatParticipant = { name: string; initiative: number; kind?: ParticipantKind; entity_id?: string; id?: string };

export const MAX_COMBAT_PARTICIPANTS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set<ParticipantKind>(["pc", "npc", "enemy"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function sortParticipants(participants: CombatParticipant[]): CombatParticipant[] {
  return [...participants].sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
}

export function blankCombatState(): CombatState {
  return { round: 1, turn: 0, participants: [], paused: false };
}

/** Strict parser: returns null for anything the panel should refuse to render or overwrite. */
export function parseCombatState(value: unknown): CombatState | null {
  if (!isRecord(value) || !Number.isInteger(value.round) || (value.round as number) < 1 || !Number.isInteger(value.turn) || (value.turn as number) < 0 || typeof value.paused !== "boolean" || !Array.isArray(value.participants) || value.participants.length > MAX_COMBAT_PARTICIPANTS) return null;
  const ids = new Set<string>();
  const participants: CombatParticipant[] = [];
  for (const item of value.participants) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 120 || !Number.isFinite(item.initiative) || (item.initiative as number) < 0 || (item.initiative as number) > 1000) return null;
    ids.add(item.id);
    // Extra keys written by other features (e.g. health, health_max, origin from the generators RPC)
    // are kept so a turn change in this panel never erases them.
    const participant: CombatParticipant = { ...item, id: item.id, name: item.name, initiative: item.initiative as number };
    if (!(typeof item.kind === "string" && KINDS.has(item.kind as ParticipantKind))) delete participant.kind;
    if (!(typeof item.entity_id === "string" && UUID.test(item.entity_id))) delete participant.entity_id;
    participants.push(participant);
  }
  if (participants.length && (value.turn as number) >= participants.length) return null;
  return { round: value.round as number, turn: value.turn as number, participants: sortParticipants(participants), paused: value.paused };
}

export class CombatStateError extends Error {}

/**
 * Pure insert used by the panel and by generators (Frente F). Keeps the active turn on the same
 * participant, rejects duplicate names (case-insensitive) and the 50-participant limit.
 */
export function insertCombatParticipants(state: CombatState, additions: NewCombatParticipant[], makeId: () => string = () => crypto.randomUUID()): CombatState {
  if (!additions.length) return state;
  if (state.participants.length + additions.length > MAX_COMBAT_PARTICIPANTS) throw new CombatStateError(`A cena aceita no máximo ${MAX_COMBAT_PARTICIPANTS} participantes.`);
  const names = new Set(state.participants.map((item) => item.name.toLocaleLowerCase()));
  const ids = new Set(state.participants.map((item) => item.id));
  const created: CombatParticipant[] = [];
  for (const addition of additions) {
    const name = typeof addition.name === "string" ? addition.name.trim() : "";
    const initiative = Number(addition.initiative);
    if (!name || name.length > 120) throw new CombatStateError("Informe um nome de até 120 caracteres.");
    if (!Number.isFinite(initiative) || initiative < 0 || initiative > 1000) throw new CombatStateError("A iniciativa deve ficar entre 0 e 1000.");
    const key = name.toLocaleLowerCase();
    if (names.has(key)) throw new CombatStateError(`Já existe um participante chamado ${name}.`);
    names.add(key);
    const id = addition.id && !ids.has(addition.id) ? addition.id : makeId();
    ids.add(id);
    const participant: CombatParticipant = { id, name, initiative };
    if (addition.kind && KINDS.has(addition.kind)) participant.kind = addition.kind;
    if (addition.entity_id && UUID.test(addition.entity_id)) participant.entity_id = addition.entity_id;
    created.push(participant);
  }
  const activeId = state.participants[state.turn]?.id;
  const participants = sortParticipants([...state.participants, ...created]);
  const turn = Math.max(0, participants.findIndex((item) => item.id === activeId));
  return { ...state, participants, turn };
}

export function advanceCombatTurn(state: CombatState): CombatState {
  if (!state.participants.length || state.paused) return state;
  const turn = (state.turn + 1) % state.participants.length;
  return { ...state, turn, round: turn === 0 ? state.round + 1 : state.round };
}

type QueryResult<T> = PromiseLike<{ data: T | null; error: unknown }>;
/** Minimal subset of the Supabase client used here, so tests can pass a fake. */
export type CombatClient = {
  from(table: "combat_sessions"): {
    select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): { maybeSingle(): QueryResult<{ state: unknown; version: number; active: boolean }> } } };
    update(values: { state: CombatState }): { eq(column: string, value: string | number): { eq(column: string, value: string | number): { eq(column: string, value: string | number): { select(columns: string): { maybeSingle(): QueryResult<{ id: string; version: number }> } } } } };
  };
};

/**
 * Appends participants to a saved combat with optimistic concurrency: reads the row, merges with
 * insertCombatParticipants and updates `where version = read version`. On a concurrent change it
 * re-reads and retries (up to `retries` times). Realtime then propagates the new state to everyone.
 * Requires a manager session (RLS on combat_sessions).
 */
export async function appendParticipantsToCombat(
  supabase: { from(table: "combat_sessions"): unknown },
  target: { campaignId: string; combatId: string },
  additions: NewCombatParticipant[],
  retries = 2,
): Promise<{ state: CombatState; version: number }> {
  // Accepts the real Supabase client without forcing TypeScript to unfold its generics.
  const client = supabase as CombatClient;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const read = await client.from("combat_sessions").select("state,version,active").eq("id", target.combatId).eq("campaign_id", target.campaignId).maybeSingle();
    if (read.error || !read.data) throw new CombatStateError("Combate não encontrado ou sem permissão.");
    if (!read.data.active) throw new CombatStateError("Este combate já foi encerrado.");
    const state = parseCombatState(read.data.state);
    if (!state) throw new CombatStateError("O estado salvo deste combate é inválido.");
    const next = insertCombatParticipants(state, additions);
    const written = await client.from("combat_sessions").update({ state: next }).eq("id", target.combatId).eq("campaign_id", target.campaignId).eq("version", read.data.version).select("id,version").maybeSingle();
    if (written.error) throw new CombatStateError("Não foi possível salvar o combate.");
    if (written.data) return { state: next, version: written.data.version };
  }
  throw new CombatStateError("O combate mudou várias vezes seguidas. Tente novamente.");
}
