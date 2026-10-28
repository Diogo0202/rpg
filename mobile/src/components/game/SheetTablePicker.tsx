import { useContext, useState } from "react";
import { NexusContext } from "@/lib/nexus/context";
import type { SheetData } from "@/lib/nexus/sheets";
import { gameSystem } from "@/lib/game/table-rules";
import { Panel } from "@/components/nexus/ui";
import { TableScreens } from "./TableScreens";

/** On the Dice page: pick a connected V3, Caçador or V5 sheet and roll through the server. */
export function SheetTablePicker() {
  const nexus = useContext(NexusContext);
  const [sheetId, setSheetId] = useState("");
  if (!nexus || nexus.mode !== "connected") return null;
  const sheets = nexus.list<SheetData>("character_sheets").filter((sheet) => gameSystem(sheet.data.system_key, sheet.data.values));
  if (!sheets.length) return null;
  const selected = sheets.find((sheet) => sheet.id === sheetId);
  return (
    <div className="mt-4 space-y-4">
      <Panel title="Rolagens da ficha">
        <label htmlFor="table-sheet" className="mb-1 block text-sm font-semibold text-ink">Ficha da campanha</label>
        <select id="table-sheet" className="field-input min-h-11 w-full" value={sheetId} onChange={(event) => setSheetId(event.target.value)}>
          <option value="">Escolha uma ficha</option>
          {sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.data.name}</option>)}
        </select>
        <p className="mt-2 text-xs text-ink-muted">V3, Caçador e V5 rolam no servidor e gravam na ficha; ajustes sem dados esperam a conexão.</p>
      </Panel>
      {selected && <TableScreens key={selected.id} sheet={selected} />}
    </div>
  );
}
