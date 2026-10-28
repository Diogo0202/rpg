import { useContext, useState } from "react";
import { NexusContext, type Entity } from "@/lib/nexus/context";
import { templateFor, type SheetData } from "@/lib/nexus/sheets";
import { gameSystem, type GameSystem } from "@/lib/game/table-rules";
import { isExperienceSystem } from "@/lib/experience-math";
import { cn } from "@/lib/utils";
import { Empty, Panel } from "@/components/nexus/ui";
import { ExperienceTablePanel } from "./ExperienceTablePanel";
import { HunterTablePanel } from "./HunterTablePanel";
import { V3TablePanel } from "./V3TablePanel";
import { V5BloodPanel } from "./V5BloodPanel";
import { V5RollPanel } from "./V5RollPanel";
import { V5SanguinePanel } from "./V5SanguinePanel";
import { useTableApi } from "./useTableApi";

type Tab = "roll" | "blood" | "hunt" | "xp";
const TABS: Record<Exclude<GameSystem, null>, Array<[Tab, string]>> = {
  "vampire-v3": [["roll", "Rolagem e sangue"], ["xp", "XP"]],
  hunter: [["roll", "Rolagem e célula"], ["xp", "XP"]],
  "vampire-v5": [["roll", "Rolagem"], ["blood", "Sangue"], ["hunt", "Caçada e vínculos"], ["xp", "XP"]],
};

/** Table screens of one connected sheet (V3, Caçador, V5 and XP), as tabs sized for touch. */
export function TableScreens({ sheet }: { sheet: Entity<SheetData> }) {
  const nexus = useContext(NexusContext);
  const api = useTableApi();
  const [tab, setTab] = useState<Tab>("roll");
  const system = gameSystem(sheet.data.system_key, sheet.data.values);
  if (!system) return null;
  if (!api.request && nexus?.mode !== "connected") return <Panel title="Mesa"><Empty>Conecte uma campanha em Sincronização para rolar pelo servidor, ajustar Sangue e comprar XP.</Empty></Panel>;
  if (!api.request) return <Panel title="Mesa"><Empty>{api.unavailable}</Empty></Panel>;
  const template = { ...templateFor(sheet.data), system_key: sheet.data.system_key ?? system };
  const tabs = TABS[system].filter(([id]) => id !== "xp" || isExperienceSystem(template.system_key));
  const active = tabs.some(([id]) => id === tab) ? tab : "roll";
  const view = { id: sheet.id, name: sheet.data.name, values: sheet.data.values };
  const donors = (nexus?.list<SheetData>("character_sheets") ?? []).map((item) => ({ id: item.id, name: item.data.name }));
  return (
    <section aria-label="Mesa" className="space-y-3">
      <div role="tablist" aria-label="Telas de mesa" className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`table-tab-${id}`} aria-selected={active === id} aria-controls={`table-panel-${id}`}
            onClick={() => setTab(id)}
            className={cn("tap shrink-0 rounded-full border px-4 text-sm font-semibold", active === id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground")}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`table-panel-${active}`} aria-labelledby={`table-tab-${active}`}>
        {active === "roll" && system === "vampire-v3" && <V3TablePanel sheet={view} api={api} />}
        {active === "roll" && system === "hunter" && <HunterTablePanel sheet={view} api={api} />}
        {active === "roll" && system === "vampire-v5" && <V5RollPanel sheetId={sheet.id} api={api} />}
        {active === "blood" && <V5BloodPanel sheet={view} api={api} />}
        {active === "hunt" && <V5SanguinePanel sheetId={sheet.id} sheetName={sheet.data.name} api={api} donors={donors} />}
        {active === "xp" && <ExperienceTablePanel sheet={{ ...view, version: sheet.version, template }} api={api} />}
      </div>
    </section>
  );
}
