import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldPanel } from "./WorldPanel";

const nexus = vi.hoisted(() => ({
  records: {} as Record<
    string,
    {
      type: string;
      id: string;
      version: number;
      pending: boolean;
      conflict: boolean;
      data: Record<string, unknown>;
    }[]
  >,
  mode: "local" as "local" | "connected",
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/nexus/store", () => ({
  useNexus: () => ({
    list: (type: string) => nexus.records[type] ?? [],
    get: (type: string, id?: string) => nexus.records[type]?.find((record) => record.id === id),
    mode: nexus.mode,
    create: nexus.create,
    update: nexus.update,
    remove: nexus.remove,
  }),
}));

const addRecord = (type: string, id: string, data: Record<string, unknown>) => {
  (nexus.records[type] ??= []).push({ type, id, version: 0, pending: true, conflict: false, data });
};

describe("WorldPanel", () => {
  beforeEach(() => {
    nexus.records = {};
    nexus.mode = "local";
    nexus.create
      .mockReset()
      .mockImplementation(async (type: string, data: Record<string, unknown>) => {
        const id = `${type}-stable-id`;
        addRecord(type, id, data);
        return id;
      });
    nexus.update.mockReset().mockResolvedValue(true);
    nexus.remove.mockReset().mockResolvedValue(undefined);
    vi.stubGlobal("confirm", () => true);
  });

  it("creates and edits a world entity with the allowed local fields", async () => {
    render(<WorldPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Nova entidade" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Guardiã do Farol" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "Vigia a costa." } });
    fireEvent.change(screen.getByLabelText("Tags, separadas por vírgula"), {
      target: { value: "costa, aliada" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entidade" }));

    await waitFor(() =>
      expect(nexus.create).toHaveBeenCalledWith("world_entities", {
        kind: "npc",
        name: "Guardiã do Farol",
        description: "Vigia a costa.",
        tags: ["costa", "aliada"],
      }),
    );
    expect(await screen.findByText("Guardiã do Farol")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar Guardiã do Farol" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Guardiã" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entidade" }));
    await waitFor(() =>
      expect(nexus.update).toHaveBeenCalledWith(
        "world_entities",
        "world_entities-stable-id",
        expect.arrayContaining([expect.objectContaining({ path: ["name"], value: "Guardiã" })]),
      ),
    );
  });

  it("does not offer the tactical map creator on mobile", () => {
    addRecord("maps", "map-1", { name: "Sala", columns: 8, rows: 8, description: "" });
    addRecord("map_pins", "pin-1", { map_id: "map-1", label: "Entrada", x: 0.5, y: 0.5, note: "" });
    render(<WorldPanel />);
    expect(screen.getByText(/exclusivo da versão web para computador/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo mapa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo marcador" })).not.toBeInTheDocument();
    expect(screen.queryByText("Sala")).not.toBeInTheDocument();
  });

  it("uses only server entity kinds when connected and queues the change for the server", async () => {
    nexus.mode = "connected";
    render(<WorldPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Nova entidade" }));
    expect(screen.getByLabelText("Tipo").querySelectorAll("option")).toHaveLength(8);
    expect(
      [...screen.getByLabelText("Tipo").querySelectorAll("option")].map((option) => option.value),
    ).toEqual(["character", "npc", "item", "rule", "location", "quest", "event", "scene"]);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "location" } });
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Porto Velho" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entidade" }));

    await waitFor(() =>
      expect(nexus.create).toHaveBeenCalledWith("world_entities", {
        kind: "location",
        name: "Porto Velho",
        description: "",
        tags: [],
      }),
    );
    expect(screen.getByText(/aguardando confirmação do servidor/)).toBeInTheDocument();
  });
});
