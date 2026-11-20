import { Btn, Empty, Panel } from "@/components/nexus/ui";
import type { Entity } from "@/lib/nexus/context";
import { NOTE_LIMIT, SUMMARY_LIMIT, TITLE_LIMIT, type NoteData, type SessionData } from "./journal-model";
import type { JournalState } from "./use-journal";

function FormError({ error }: { error: string }) {
  return error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null;
}

export function SessionForm({ journal }: { journal: JournalState }) {
  const { session, setSession, sessionId } = journal;
  return (
    <Panel title={sessionId ? "Editar sessão" : "Nova sessão"}>
      <form className="space-y-3" onSubmit={(event) => void journal.saveSession(event)}>
        <label className="block text-sm font-semibold text-ink">
          Título
          <input className="field-input mt-1" value={session.title} onChange={(event) => setSession({ ...session, title: event.target.value })} maxLength={TITLE_LIMIT} required />
        </label>
        <label className="block text-sm font-semibold text-ink">
          Data
          <input className="field-input mt-1" type="date" value={session.date} onChange={(event) => setSession({ ...session, date: event.target.value })} required />
        </label>
        <label className="block text-sm font-semibold text-ink">
          Resumo
          <textarea className="field-input mt-1 min-h-24" value={session.summary} onChange={(event) => setSession({ ...session, summary: event.target.value })} maxLength={SUMMARY_LIMIT} />
        </label>
        <div className="flex gap-2">
          <Btn type="submit">{sessionId ? "Salvar sessão" : "Criar sessão"}</Btn>
          {sessionId && <Btn variant="outline" onClick={journal.resetSession}>Cancelar</Btn>}
        </div>
        <FormError error={journal.error} />
      </form>
    </Panel>
  );
}

export function NoteForm({ journal }: { journal: JournalState }) {
  const { note, setNote, noteId, sessions } = journal;
  return (
    <Panel title="Nova nota">
      {sessions.length === 0 ? (
        <Empty>Crie uma sessão antes de adicionar notas.</Empty>
      ) : (
        <form className="space-y-3" onSubmit={(event) => void journal.saveNote(event)}>
          <label className="block text-sm font-semibold text-ink">
            Sessão
            <select className="field-input mt-1" value={note.sessionId} onChange={(event) => setNote({ ...note, sessionId: event.target.value })}>
              {sessions.map((session) => <option key={session.id} value={session.id}>{session.data.title}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-ink">
            Título
            <input className="field-input mt-1" value={note.title} onChange={(event) => setNote({ ...note, title: event.target.value })} maxLength={TITLE_LIMIT} required />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Nota
            <textarea className="field-input mt-1 min-h-24" value={note.body} onChange={(event) => setNote({ ...note, body: event.target.value })} maxLength={NOTE_LIMIT} required />
          </label>
          <div className="flex gap-2">
            <Btn type="submit">{noteId ? "Salvar nota" : "Adicionar nota"}</Btn>
            {noteId && <Btn variant="outline" onClick={journal.resetNote}>Cancelar edição</Btn>}
          </div>
          <FormError error={journal.error} />
        </form>
      )}
    </Panel>
  );
}

function NoteCard({ note, journal }: { note: Entity<NoteData>; journal: JournalState }) {
  return (
    <article className="parchment-inset p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-ink">{note.data.title}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{note.data.body}</p>
          {note.pending && <p className="mt-1 text-xs text-ink-muted">Pendente local</p>}
        </div>
        <div className="flex gap-1">
          <Btn size="sm" variant="outline" onClick={() => journal.editNote(note)}>Editar</Btn>
          <Btn size="sm" variant="danger" onClick={() => void journal.deleteNote(note.id)}>Excluir</Btn>
        </div>
      </div>
    </article>
  );
}

export function SessionCard({ session, journal }: { session: Entity<SessionData>; journal: JournalState }) {
  return (
    <Panel
      title={session.data.title}
      actions={
        <>
          <Btn size="sm" variant="outline" onClick={() => journal.editSession(session)}>Editar</Btn>
          <Btn size="sm" variant="danger" onClick={() => void journal.deleteSession(session.id)}>Excluir</Btn>
        </>
      }
    >
      <p className="text-xs text-ink-muted">
        {session.data.session_date}
        {session.pending ? " · pendente local" : ""}
      </p>
      {session.data.summary && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{session.data.summary}</p>}
      <div className="mt-3 space-y-2">
        {journal.notesOf(session.id).map((note) => <NoteCard key={note.id} note={note} journal={journal} />)}
      </div>
    </Panel>
  );
}
