import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPanel } from "./mais";

const nexus = vi.hoisted(() => ({
  mode: "local" as "local" | "connected",
  templates: [] as { id: string; data: Record<string, unknown> }[],
}));

vi.mock("@/lib/nexus/store", () => ({
  useNexus: () => ({
    ready: true,
    error: null,
    mode: nexus.mode,
    list: (type: string) => type === "system_templates" ? nexus.templates : [],
  }),
  outboxSummary: () => ({ total: 0 }),
}));

vi.mock("@/components/nexus/SheetImport", () => ({
  SheetImport: () => <button type="button">Importar ficha</button>,
}));

describe("Biblioteca em Mais", () => {
  beforeEach(() => {
    nexus.mode = "local";
    nexus.templates = [];
  });

  it("exibe os modelos-base locais e informa que os perfis são parciais", () => {
    render(<LibraryPanel />);

    expect(screen.getByText("Vampiro V5")).toBeInTheDocument();
    expect(screen.getByText(/não incluem regras oficiais completas/i)).toBeInTheDocument();
    expect(screen.queryByText("Nenhum modelo aprovado disponível nesta campanha.")).not.toBeInTheDocument();
  });

  it("mostra somente templates aprovados da campanha, com sistema e versão", () => {
    nexus.mode = "connected";
    nexus.templates = [
      {
        id: "template-approved",
        data: {
          status: "approved",
          name: "Crônicas da Noite",
          version: 4,
          schema: { system_key: "vampire-v5", fields: [] },
        },
      },
      {
        id: "template-draft",
        data: { status: "needs_review", name: "Rascunho", version: 1, schema: {} },
      },
    ];

    render(<LibraryPanel />);

    expect(screen.getByText("Crônicas da Noite")).toBeInTheDocument();
    expect(screen.getByText("Sistema: Vampiro V5")).toBeInTheDocument();
    expect(screen.getByText("Aprovado · versão 4")).toBeInTheDocument();
    expect(screen.queryByText("Rascunho")).not.toBeInTheDocument();
    expect(screen.queryByText(/catálogo remoto não está conectado/i)).not.toBeInTheDocument();
  });

  it("apresenta estado vazio quando a campanha conectada não tem modelo aprovado", () => {
    nexus.mode = "connected";
    nexus.templates = [{
      id: "template-invalid-version",
      data: { status: "approved", name: "Sem versão", version: true, schema: {} },
    }];

    render(<LibraryPanel />);

    expect(screen.getByText("Nenhum modelo aprovado disponível nesta campanha.")).toBeInTheDocument();
  });
});
