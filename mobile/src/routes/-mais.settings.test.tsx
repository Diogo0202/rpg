import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./mais";

const nexus = vi.hoisted(() => ({
  state: { outbox: [{}, {}] },
  engine: { exportPendingDrafts: vi.fn() },
  ready: true,
  wipeLocal: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/nexus/store", () => ({
  useNexus: () => nexus,
  outboxSummary: (state: { outbox: unknown[] }) => ({
    total: state.outbox.length,
    queued: state.outbox.length,
    conflicts: 0,
    blocked: 0,
  }),
}));
vi.mock("@/components/nexus/ConnectionPanel", () => ({ ConnectionPanel: () => null }));
vi.mock("@/components/nexus/SheetImport", () => ({ SheetImport: () => null }));

describe("SettingsPanel local cache confirmation", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    document.documentElement.classList.remove("dark");
    nexus.wipeLocal.mockReset().mockResolvedValue(undefined);
    nexus.refresh.mockReset().mockResolvedValue(undefined);
    nexus.engine.exportPendingDrafts.mockReset().mockResolvedValue({ operations: [] });
  });

  it("keeps the dark card theme after reopening settings", () => {
    const view = render(<SettingsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Escuro" }));
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("button", { name: "Escuro" })).toHaveAttribute("aria-pressed", "true");
    view.unmount();
    render(<SettingsPanel />);
    expect(screen.getByRole("button", { name: "Escuro" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Padrão" }));
    expect(document.documentElement).not.toHaveClass("dark");
  });

  it("allows cancel or Escape and only clears all account campaigns after manual confirmation", async () => {
    render(<SettingsPanel />);
    const trigger = screen.getByRole("button", { name: "Apagar cópias locais" });
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog", { name: "Apagar cópias locais?" });
    expect(dialog).toHaveTextContent("todas as campanhas desta conta neste aparelho");
    expect(dialog).toHaveTextContent("somente a campanha aberta");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(nexus.wipeLocal).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(nexus.wipeLocal).not.toHaveBeenCalled();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar e apagar" }));
    await waitFor(() => expect(nexus.wipeLocal).toHaveBeenCalledTimes(1));
    expect(nexus.refresh).toHaveBeenCalledTimes(1);
  });
});
