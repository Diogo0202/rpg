import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NexusContext, type Entity, type NexusContextValue } from "@/lib/nexus/context";
import type { SheetData } from "@/lib/nexus/sheets";
import { TableScreens } from "./TableScreens";

const sheet = (systemKey: string | null): Entity<SheetData> => ({
  type: "character_sheets", id: "22222222-2222-4222-8222-222222222222", version: 1, pending: false, conflict: false,
  data: { name: "Ana", system_key: systemKey, template_name: "X", template_version: 1, values: {}, effects: [] },
});

function withMode(mode: "local" | "connected", children: React.ReactNode) {
  const value = { mode, user: mode === "connected" ? { id: "u", email: null } : null, capabilities: null, list: () => [], syncNow: async () => undefined } as unknown as NexusContextValue;
  return <NexusContext.Provider value={value}>{children}</NexusContext.Provider>;
}

describe("TableScreens", () => {
  it("asks to connect a campaign in local mode", () => {
    render(withMode("local", <TableScreens sheet={sheet("vampire-v5")} />));
    expect(screen.getByText(/Conecte uma campanha em Sincronização/)).toBeInTheDocument();
  });

  it("renders nothing for systems without table screens", () => {
    const { container } = render(withMode("local", <TableScreens sheet={sheet("one-ring")} />));
    expect(container).toBeEmptyDOMElement();
  });
});
