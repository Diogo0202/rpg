import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn, Empty, LocalGate, PageHeader, Panel } from "@/components/nexus/ui";
import { useNexus } from "@/lib/nexus/store";

export const Route = createFileRoute("/mais/diario")({
  head: () => ({
    meta: [
      { title: "Diário — RPG-Atlas Mobile" },
      { name: "description", content: "Sessões e notas salvas neste aparelho." },
      { property: "og:title", content: "Diário — RPG-Atlas Mobile" },
      { property: "og:description", content: "Sessões e notas salvas neste aparelho." },
    ],
  }),
  component: () => (
    <LocalGate>
      <Diary />
    </LocalGate>
  ),
});

type SessionData = { title: string; session_date: string; summary?: string };
type NoteData = { session_id: string; title: string; body: string };

function Diary() {
  const { list, create, update, remove } = useNexus();
  const sessions = useMemo(
    () =>
      list<SessionData>("journal_sessions").sort((a, b) =>
        b.data.session_date.localeCompare(a.data.session_date),
      ),
    [list],
  );
  const notes = list<NoteData>("journal_notes");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState("");
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState("");
  const [noteId, setNoteId] = useState<string | null>(null);
  const [noteSessionId, setNoteSessionId] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const clearSessionForm = () => {
    setSessionId(null);
    setSessionTitle("");
    setSessionDate(new Date().toISOString().slice(0, 10));
    setSummary("");
    setError("");
  };
  const clearNoteForm = () => {
    setNoteId(null);
    setNoteSessionId(sessions[0]?.id ?? "");
    setNoteTitle("");
    setBody("");
    setError("");
  };

  const saveSession = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (
      !sessionTitle.trim() ||
      !sessionDate ||
      sessionTitle.trim().length > 120 ||
      summary.length > 4000
    ) {
      setError("Confira o título, a data e o resumo (até 4.000 caracteres).");
      return;
    }
    try {
      const values = {
        title: sessionTitle.trim(),
        session_date: sessionDate,
        summary: summary.trim(),
      };
      if (sessionId)
        await update(
          "journal_sessions",
          sessionId,
          Object.entries(values).map(([key, value]) => ({ path: [key], value })),
        );
      else await create("journal_sessions", values);
      toast.success("Sessão salva neste aparelho.");
      clearSessionForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar a sessão.");
    }
  };
  const saveNote = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (
      !noteSessionId ||
      !noteTitle.trim() ||
      noteTitle.trim().length > 120 ||
      body.length > 8000
    ) {
      setError("Escolha uma sessão e informe o título e o texto (até 8.000 caracteres).");
      return;
    }
    try {
      const values = { session_id: noteSessionId, title: noteTitle.trim(), body };
      if (noteId)
        await update(
          "journal_notes",
          noteId,
          Object.entries(values).map(([key, value]) => ({ path: [key], value })),
        );
      else
        await create("journal_notes", values, {
          dependsOnEntities: [["journal_sessions", noteSessionId]],
        });
      toast.success("Nota salva neste aparelho.");
      clearNoteForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar a nota.");
    }
  };
  const deleteSession = async (id: string) => {
    if (!window.confirm("Excluir esta sessão e todas as notas ligadas a ela?")) return;
    try {
      for (const note of notes.filter((item) => item.data.session_id === id))
        await remove("journal_notes", note.id);
      await remove("journal_sessions", id);
      if (sessionId === id) clearSessionForm();
      toast.success("Sessão e notas removidas da fila local.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir a sessão.");
    }
  };
  const deleteNote = async (id: string) => {
    if (!window.confirm("Excluir esta nota?")) return;
    try {
      await remove("journal_notes", id);
      if (noteId === id) clearNoteForm();
      toast.success("Nota removida da fila local.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir a nota.");
    }
  };

  return (
    <>
      <PageHeader
        title="Diário"
        subtitle="Sessões e notas ficam no armazenamento deste aparelho."
        actions={
          <Link
            to="/mais"
            className="tap rounded-lg border border-ink/30 px-3 text-sm font-semibold text-ink"
          >
            Voltar a Mais
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={sessionId ? "Editar sessão" : "Nova sessão"}>
          <form className="space-y-3" onSubmit={(e) => void saveSession(e)}>
            <label className="block text-sm font-semibold text-ink">
              Título
              <input
                className="field-input mt-1"
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Data
              <input
                className="field-input mt-1"
                type="date"
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Resumo
              <textarea
                className="field-input mt-1 min-h-24"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={4000}
              />
            </label>
            <div className="flex gap-2">
              <Btn type="submit">{sessionId ? "Salvar sessão" : "Criar sessão"}</Btn>
              {sessionId && (
                <Btn variant="outline" onClick={clearSessionForm}>
                  Cancelar
                </Btn>
              )}
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        </Panel>
        <Panel title="Nova nota">
          {sessions.length === 0 ? (
            <Empty>Crie uma sessão antes de adicionar notas.</Empty>
          ) : (
            <form className="space-y-3" onSubmit={(e) => void saveNote(e)}>
              <label className="block text-sm font-semibold text-ink">
                Sessão
                <select
                  className="field-input mt-1"
                  value={noteSessionId}
                  onChange={(e) => setNoteSessionId(e.target.value)}
                >
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.data.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-semibold text-ink">
                Título
                <input
                  className="field-input mt-1"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  maxLength={120}
                  required
                />
              </label>
              <label className="block text-sm font-semibold text-ink">
                Nota
                <textarea
                  className="field-input mt-1 min-h-24"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={8000}
                  required
                />
              </label>
              <div className="flex gap-2">
                <Btn type="submit">{noteId ? "Salvar nota" : "Adicionar nota"}</Btn>
                {noteId && (
                  <Btn variant="outline" onClick={clearNoteForm}>
                    Cancelar edição
                  </Btn>
                )}
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </form>
          )}
        </Panel>
      </div>
      <div className="mt-4 space-y-3">
        {!sessions.length && <Empty>Nenhuma sessão registrada.</Empty>}
        {sessions.map((session) => (
          <Panel
            key={session.id}
            title={session.data.title}
            actions={
              <>
                <Btn
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setSessionId(session.id);
                    setSessionTitle(session.data.title);
                    setSessionDate(session.data.session_date);
                    setSummary(session.data.summary ?? "");
                  }}
                >
                  Editar
                </Btn>
                <Btn size="sm" variant="danger" onClick={() => void deleteSession(session.id)}>
                  Excluir
                </Btn>
              </>
            }
          >
            <p className="text-xs text-ink-muted">
              {session.data.session_date}
              {session.pending ? " · pendente local" : ""}
            </p>
            {session.data.summary && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{session.data.summary}</p>
            )}
            <div className="mt-3 space-y-2">
              {notes
                .filter((note) => note.data.session_id === session.id)
                .map((note) => (
                  <article key={note.id} className="parchment-inset p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-ink">{note.data.title}</h3>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                          {note.data.body}
                        </p>
                        {note.pending && (
                          <p className="mt-1 text-xs text-ink-muted">Pendente local</p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Btn
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setNoteId(note.id);
                            setNoteSessionId(note.data.session_id);
                            setNoteTitle(note.data.title);
                            setBody(note.data.body);
                          }}
                        >
                          Editar
                        </Btn>
                        <Btn size="sm" variant="danger" onClick={() => void deleteNote(note.id)}>
                          Excluir
                        </Btn>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
