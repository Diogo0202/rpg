/** Regras do diário local, sem React: validação de sessões e notas. */

import type { PathSet } from "@/lib/nexus/context";

export type SessionData = { title: string; session_date: string; summary?: string };
export type NoteData = { session_id: string; title: string; body: string };

export const TITLE_LIMIT = 120;
export const SUMMARY_LIMIT = 4000;
export const NOTE_LIMIT = 8000;

export type SessionDraft = { title: string; date: string; summary: string };
export type NoteDraft = { sessionId: string; title: string; body: string };

export const today = () => new Date().toISOString().slice(0, 10);
export const emptySession = (): SessionDraft => ({ title: "", date: today(), summary: "" });
export const emptyNote = (sessionId = ""): NoteDraft => ({ sessionId, title: "", body: "" });

type Checked<T> = { error: string } | { values: T };

export function checkSession(draft: SessionDraft): Checked<SessionData> {
  const title = draft.title.trim();
  if (!title || !draft.date || title.length > TITLE_LIMIT || draft.summary.length > SUMMARY_LIMIT)
    return { error: "Confira o título, a data e o resumo (até 4.000 caracteres)." };
  return { values: { title, session_date: draft.date, summary: draft.summary.trim() } };
}

export function checkNote(draft: NoteDraft): Checked<NoteData> {
  const title = draft.title.trim();
  if (!draft.sessionId || !title || title.length > TITLE_LIMIT || draft.body.length > NOTE_LIMIT)
    return { error: "Escolha uma sessão e informe o título e o texto (até 8.000 caracteres)." };
  return { values: { session_id: draft.sessionId, title, body: draft.body } };
}

/** Uma troca de caminho por campo, para editar um registro existente. */
export function fieldSets(values: Record<string, string>): PathSet[] {
  return Object.entries(values).map(([key, value]) => ({ path: [key], value }));
}

/** Sessões mais recentes primeiro. */
export function newestFirst<T extends { data: SessionData }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => b.data.session_date.localeCompare(a.data.session_date));
}
