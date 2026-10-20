import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookOpen, Dices, Map, Plus } from "lucide-react";
import { toast } from "sonner";
import { Btn, btn, Empty, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";
import { useNexus } from "@/lib/nexus/store";
import { LOCAL_CAMPAIGN_NAME } from "@/lib/nexus/config";
import { starterById, type SheetData } from "@/lib/nexus/sheets";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mesa — RPG-Atlas Mobile" },
      { name: "description", content: "Campanha, sessão atual e personagens da mesa no RPG-Atlas Mobile." },
      { property: "og:title", content: "Mesa — RPG-Atlas Mobile" },
      { property: "og:description", content: "Campanha, sessão atual e personagens da mesa no RPG-Atlas Mobile." },
    ],
  }),
  component: Mesa,
});

type CampaignState = { current_session_id?: string; scene?: string };
type Session = { title: string; session_date: string; summary?: string };

function Mesa() {
  return (
    <>
      <PageHeader title="Mesa" subtitle={<>{LOCAL_CAMPAIGN_NAME} · <Tag tone="warn">dados demonstrativos, sem sessão autenticada</Tag></>} />
      <LocalGate><MesaBody /></LocalGate>
    </>
  );
}

function MesaBody() {
  const { list, get, update } = useNexus();
  const cs = list<CampaignState>("campaign_state")[0];
  const session = get<Session>("journal_sessions", cs?.data.current_session_id);
  const sheets = list<SheetData>("character_sheets").sort((a, b) => a.data.name.localeCompare(b.data.name));
  const [scene, setScene] = useState(cs?.data.scene ?? "");
  useEffect(() => { setScene(cs?.data.scene ?? ""); }, [cs?.data.scene]);

  const toggle = async (id: string, value: boolean) => {
    try { await update("character_sheets", id, [{ path: ["values", "ativo_na_sessao"], value }]); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Falha ao salvar."); }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Sessão atual" className="md:col-span-2"
        actions={<Link to="/mais/diario" className={btn({ variant: "outline", size: "sm" })}>Abrir diário</Link>}>
        {session ? (
          <div className="space-y-3">
            <div>
              <p className="font-display text-xl font-semibold text-ink">{session.data.title}</p>
              <p className="text-sm text-ink-muted">{session.data.session_date}</p>
            </div>
            {cs && (
              <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); await update("campaign_state", cs.id, [{ path: ["scene"], value: scene }]); toast.success("Cena salva neste aparelho."); }}>
                <label htmlFor="cena" className="block text-sm font-semibold text-ink">Cena</label>
                <textarea id="cena" className="field-input min-h-20" value={scene} onChange={(e) => setScene(e.target.value)} maxLength={2000} />
                <Btn type="submit" variant="ink" size="sm" disabled={scene === (cs.data.scene ?? "")}>Salvar cena</Btn>
              </form>
            )}
          </div>
        ) : <Empty>Nenhuma sessão selecionada. Crie uma no Diário.</Empty>}
      </Panel>

      <Panel title="Personagens" className="md:col-span-2"
        actions={<Link to="/fichas/nova" className={btn({ size: "sm" })}><Plus className="size-4" aria-hidden />Nova ficha</Link>}>
        {sheets.length === 0 ? <Empty>Nenhum personagem ainda. Crie uma ficha guiada para V5, Caçador ou O Um Anel.</Empty> : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {sheets.map((s) => {
              const active = s.data.values?.["ativo_na_sessao"] === true;
              return (
                <li key={s.id} className="parchment-inset flex items-center justify-between gap-2 p-3">
                  <Link to="/fichas" search={{ ficha: s.id }} className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-ink">{s.data.name}</p>
                    <p className="truncate text-xs text-ink-muted">{starterById(s.data.system_key)?.label ?? s.data.template_name}{s.pending ? " · pendente local" : ""}</p>
                  </Link>
                  <label className="tap flex cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
                    <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => void toggle(s.id, e.target.checked)} />
                    Na sessão
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Atalhos" className="md:col-span-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Link to="/fichas/nova" className={btn({ variant: "outline" })}><Plus className="size-4" aria-hidden />Ficha</Link>
          <Link to="/dados" className={btn({ variant: "outline" })}><Dices className="size-4" aria-hidden />Rolar</Link>
          <Link to="/mundo" className={btn({ variant: "outline" })}><Map className="size-4" aria-hidden />Mapas</Link>
          <Link to="/mais/diario" className={btn({ variant: "outline" })}><BookOpen className="size-4" aria-hidden />Diário</Link>
        </div>
      </Panel>
    </div>
  );
}

