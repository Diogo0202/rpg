import { createFileRoute, Link } from "@tanstack/react-router";
import { NoteForm, SessionCard, SessionForm } from "@/components/nexus/journal/journal-views";
import { useJournal } from "@/components/nexus/journal/use-journal";
import { Empty, LocalGate, PageHeader } from "@/components/nexus/ui";

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

function Diary() {
  const journal = useJournal();
  return (
    <>
      <PageHeader
        title="Diário"
        subtitle="Sessões e notas ficam no armazenamento deste aparelho."
        actions={
          <Link to="/mais" className="tap rounded-lg border border-ink/30 px-3 text-sm font-semibold text-ink">
            Voltar a Mais
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <SessionForm journal={journal} />
        <NoteForm journal={journal} />
      </div>
      <div className="mt-4 space-y-3">
        {!journal.sessions.length && <Empty>Nenhuma sessão registrada.</Empty>}
        {journal.sessions.map((session) => <SessionCard key={session.id} session={session} journal={journal} />)}
      </div>
    </>
  );
}
