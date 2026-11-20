import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SheetEditor } from "@/components/nexus/SheetEditor";
import { SheetImport } from "@/components/nexus/SheetImport";
import { TableScreens } from "@/components/game/TableScreens";
import { GrimoireShelf } from "@/components/nexus/GrimoireShelf";
import { btn, LocalGate, PageHeader } from "@/components/nexus/ui";
import { useNexus } from "@/lib/nexus/store";
import { starterById, type SheetData } from "@/lib/nexus/sheets";

export const Route = createFileRoute("/fichas/")({
  validateSearch: (s: Record<string, unknown>): { ficha?: string } => (typeof s.ficha === "string" ? { ficha: s.ficha } : {}),
  head: () => ({ meta: [
    { title: "Fichas — RPG-Atlas Mobile" }, { name: "description", content: "Fichas de personagem salvas neste aparelho." },
    { property: "og:title", content: "Fichas — RPG-Atlas Mobile" }, { property: "og:description", content: "Fichas de personagem salvas neste aparelho." },
  ] }),
  component: Fichas,
});

function Fichas() {
  return <LocalGate><List /></LocalGate>;
}
function List() {
  const { list } = useNexus();
  const navigate = useNavigate();
  const { ficha } = Route.useSearch();
  const sheets = list<SheetData>("character_sheets");
  const selected = sheets.find((s) => s.id === ficha);
  if (selected) return <div className="sheet-system-theme space-y-4" data-system-theme={selected.data.system_key === "demon-the-fallen" ? "demon-the-fallen" : undefined}><PageHeader title={selected.data.name} actions={<Link to="/fichas" search={{}} className={btn({variant: "outline"})}>Todas as fichas</Link>} /><SheetEditor key={selected.id} sheet={selected} /><TableScreens key={`mesa-${selected.id}`} sheet={selected} /></div>;
  return (
    <><PageHeader title="Fichas" actions={<><SheetImport onImported={(id) => { void navigate({to: "/fichas", search: {ficha: id}}); }} /><Link to="/fichas/nova" className={btn()}>Nova ficha</Link></>} />
    <GrimoireShelf
      label="Estante de fichas"
      openLabel="Abrir ficha"
      books={sheets.map((s) => ({
        id: s.id,
        title: s.data.name,
        subtitle: starterById(s.data.system_key)?.label ?? s.data.template_name,
        systemKey: s.data.system_key,
        footnote: s.pending ? "Pendente local" : undefined,
      }))}
      onOpen={(book) => { void navigate({ to: "/fichas", search: { ficha: book.id } }); }}
      addSlot={{ title: "Nova ficha", hint: "Escolher um sistema", onClick: () => { void navigate({ to: "/fichas/nova" }); } }}
    /></>
  );
}

