import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Entity } from "@/lib/nexus/context";
import { useNexus } from "@/lib/nexus/store";
import {
  checkNote,
  checkSession,
  emptyNote,
  emptySession,
  fieldSets,
  newestFirst,
  type NoteData,
  type NoteDraft,
  type SessionData,
  type SessionDraft,
} from "./journal-model";

const errorMessage = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

/** Estado e gravação do diário local: rascunhos de sessão e nota, edição e exclusão. */
export function useJournal() {
  const { list, create, update, remove } = useNexus();
  const sessions = useMemo(() => newestFirst(list<SessionData>("journal_sessions")), [list]);
  const notes = list<NoteData>("journal_notes");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionDraft>(emptySession);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [note, setNote] = useState<NoteDraft>(() => emptyNote());
  const [error, setError] = useState("");

  // The select shows the first session while nothing is chosen; save that one too.
  const noteDraft: NoteDraft = { ...note, sessionId: note.sessionId || sessions[0]?.id || "" };

  const resetSession = () => {
    setSessionId(null);
    setSession(emptySession());
    setError("");
  };
  const resetNote = () => {
    setNoteId(null);
    setNote(emptyNote(sessions[0]?.id ?? ""));
    setError("");
  };

  const saveSession = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const checked = checkSession(session);
    if ("error" in checked) return setError(checked.error);
    try {
      if (sessionId) await update("journal_sessions", sessionId, fieldSets(checked.values));
      else await create("journal_sessions", checked.values);
      toast.success("Sessão salva neste aparelho.");
      resetSession();
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a sessão."));
    }
  };

  const saveNote = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const checked = checkNote(noteDraft);
    if ("error" in checked) return setError(checked.error);
    try {
      if (noteId) await update("journal_notes", noteId, fieldSets(checked.values));
      else await create("journal_notes", checked.values, { dependsOnEntities: [["journal_sessions", checked.values.session_id]] });
      toast.success("Nota salva neste aparelho.");
      resetNote();
    } catch (caught) {
      setError(errorMessage(caught, "Não foi possível salvar a nota."));
    }
  };

  const editSession = (entry: Entity<SessionData>) => {
    setSessionId(entry.id);
    setSession({ title: entry.data.title, date: entry.data.session_date, summary: entry.data.summary ?? "" });
  };

  const editNote = (entry: Entity<NoteData>) => {
    setNoteId(entry.id);
    setNote({ sessionId: entry.data.session_id, title: entry.data.title, body: entry.data.body });
  };

  const deleteSession = async (id: string) => {
    if (!window.confirm("Excluir esta sessão e todas as notas ligadas a ela?")) return;
    try {
      for (const entry of notes.filter((item) => item.data.session_id === id)) await remove("journal_notes", entry.id);
      await remove("journal_sessions", id);
      if (sessionId === id) resetSession();
      toast.success("Sessão e notas removidas da fila local.");
    } catch (caught) {
      toast.error(errorMessage(caught, "Não foi possível excluir a sessão."));
    }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm("Excluir esta nota?")) return;
    try {
      await remove("journal_notes", id);
      if (noteId === id) resetNote();
      toast.success("Nota removida da fila local.");
    } catch (caught) {
      toast.error(errorMessage(caught, "Não foi possível excluir a nota."));
    }
  };

  return {
    sessions,
    notesOf: (id: string) => notes.filter((entry) => entry.data.session_id === id),
    sessionId,
    session,
    setSession,
    noteId,
    note: noteDraft,
    setNote,
    error,
    saveSession,
    saveNote,
    resetSession,
    resetNote,
    editSession,
    editNote,
    deleteSession,
    deleteNote,
  };
}

export type JournalState = ReturnType<typeof useJournal>;
