import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SheetEditor } from "@/components/nexus/SheetEditor";
import { SheetImport } from "@/components/nexus/SheetImport";
import { btn, Empty, LocalGate, PageHeader, Panel } from "@/components/nexus/ui";
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
  if (selected) return <><PageHeader title={selected.data.name} actions={<Link to="/fichas" search={{}} className={btn({variant: "outline"})}>Todas as fichas</Link>} /><SheetEditor key={selected.id} sheet={selected} /></>;
  return (
    <><PageHeader title="Fichas" actions={<><SheetImport onImported={(id) => { void navigate({to: "/fichas", search: {ficha: id}}); }} /><Link to="/fichas/nova" className={btn()}>Nova ficha</Link></>} />
    {!sheets.length && <Empty>Nenhuma ficha ainda.</Empty>}
    <div className="grid gap-2">
      {sheets.map((s) => (
        <Panel key={s.id} className={s.id === ficha ? "ring-2 ring-ring" : ""}>
          <Link to="/fichas" search={{ficha: s.id}} className="block tap">
          <p className="font-semibold text-ink">{s.data.name}</p>
          <p className="text-xs text-ink-muted">{starterById(s.data.system_key)?.label ?? s.data.template_name}{s.pending ? " · pendente local" : ""}</p>
          </Link>
        </Panel>
      ))}
    </div></>
  );
}

