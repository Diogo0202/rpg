import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldPanel } from "./WorldPanel";

const nexus = vi.hoisted(() => ({
  records: {} as Record<string, { type: string; id: string; version: number; pending: boolean; conflict: boolean; data: Record<string, unknown> }[]>,
  create: vi.fn(), update: vi.fn(), remove: vi.fn(),
}));

vi.mock("@/lib/nexus/store", () => ({
  useNexus: () => ({
    list: (type: string) => nexus.records[type] ?? [],
    get: (type: string, id?: string) => nexus.records[type]?.find((record) => record.id === id),
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
    nexus.create.mockReset().mockImplementation(async (type: string, data: Record<string, unknown>) => {
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
    fireEvent.change(screen.getByLabelText("Tags, separadas por vírgula"), { target: { value: "costa, aliada" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entidade" }));

    await waitFor(() => expect(nexus.create).toHaveBeenCalledWith("world_entities", {
      kind: "npc", name: "Guardiã do Farol", description: "Vigia a costa.", tags: ["costa", "aliada"],
    }));
    expect(await screen.findByText("Guardiã do Farol")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar Guardiã do Farol" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Guardiã" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entidade" }));
    await waitFor(() => expect(nexus.update).toHaveBeenCalledWith("world_entities", "world_entities-stable-id", expect.arrayContaining([
      expect.objectContaining({ path: ["name"], value: "Guardiã" }),
    ])));
  });

  it("creates a map and a stable-ID marker, and validates coordinates", async () => {
    render(<WorldPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Novo mapa" }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Porto Velho" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar mapa" }));
    await waitFor(() => expect(nexus.create).toHaveBeenCalledWith("maps", {
      name: "Porto Velho", columns: 12, rows: 9, description: "",
    }));

    fireEvent.click(await screen.findByRole("button", { name: "Novo marcador" }));
    fireEvent.change(screen.getByLabelText("Rótulo"), { target: { value: "Portão" } });
    fireEvent.change(screen.getByLabelText("X, de 0 a 1"), { target: { value: "1.2" } });
    fireEvent.submit(screen.getByRole("heading", { name: "Novo marcador" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("coordenadas devem ficar entre 0 e 1");
    expect(nexus.create).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("X, de 0 a 1"), { target: { value: "0.25" } });
    fireEvent.change(screen.getByLabelText("Y, de 0 a 1"), { target: { value: "0.75" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar marcador" }));
    await waitFor(() => expect(nexus.create).toHaveBeenLastCalledWith("map_pins", {
      label: "Portão", x: 0.25, y: 0.75, note: "", map_id: "maps-stable-id",
    }, { dependsOnEntities: [["maps", "maps-stable-id"]] }));
    expect((await screen.findAllByText("Portão")).length).toBeGreaterThan(0);
    expect(screen.getByRole("group", { name: "Grid do mapa Porto Velho" })).toBeInTheDocument();
    expect(screen.getByLabelText("Zoom do grid")).toBeInTheDocument();
  });

  it("removes map pins before removing their map", async () => {
    addRecord("maps", "map-1", { name: "Sala", columns: 8, rows: 8, description: "" });
    addRecord("map_pins", "pin-1", { map_id: "map-1", label: "Entrada", x: 0.5, y: 0.5, note: "" });
    render(<WorldPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Excluir mapa Sala" }));
    await waitFor(() => expect(nexus.remove).toHaveBeenNthCalledWith(1, "map_pins", "pin-1"));
    expect(nexus.remove).toHaveBeenNthCalledWith(2, "maps", "map-1");
  });
});
