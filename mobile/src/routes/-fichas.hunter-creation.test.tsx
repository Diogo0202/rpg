import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_STARTERS } from "../../../shared/rules/system-starters";
import type { FieldValue, SheetTemplate } from "../../../shared/rules/sheet-template";
import legacyTemplate from "../../../backend/tests/fixtures/hunter_starter.json";
import { hunterTemplateCreationProblems } from "@/lib/nexus/hunter-creation";
import { Route } from "./fichas.nova";

const state = vi.hoisted(() => ({
  create: vi.fn(async () => "sheet-created"),
  navigate: vi.fn(),
  mode: "connected" as "local" | "connected",
  templates: [] as Array<{ id: string; data: Record<string, unknown> }>,
}));
vi.mock("@/lib/nexus/store", () => ({
  useNexus: () => ({
    ready: true,
    error: null,
    mode: state.mode,
    create: state.create,
    list: () => state.templates,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => state.navigate,
}));

const v5 = SYSTEM_STARTERS.find((starter) => starter.id === "hunter")!;
const v4 = legacyTemplate as SheetTemplate;
const identity = { nome: "Ana", credo: "Marcial", impulso: "Juramento" };
const legacy = {
  ...identity,
  conviccao_1: "Proteger a família",
  pedra_toque_1: "Clara",
  triunfos: ["Arsenal", "Biblioteca"],
  distincoes: ["Arsenal: Especializado"],
};

describe("Caçador: validação do modelo aprovado", () => {
  it("accepts both v5 allocations and rejects the old 2+1 allocation", () => {
    for (const pilares of [[], ["Clara"], ["Clara", "João", "Eva"]]) {
      expect(
        hunterTemplateCreationProblems(v5.template, {
          ...identity,
          pilares,
          triunfos: ["Arsenal", "Frota"],
          distincoes: [],
        }),
      ).toEqual([]);
      expect(
        hunterTemplateCreationProblems(v5.template, {
          ...identity,
          pilares,
          triunfos: ["Arsenal"],
          distincoes: ["Arsenal: Exóticas", "Arsenal: Irrastreável"],
        }),
      ).toEqual([]);
    }
    expect(
      hunterTemplateCreationProblems(v5.template, {
        ...identity,
        triunfos: ["Arsenal", "Frota"],
        distincoes: ["Arsenal: Exóticas"],
      }),
    ).toContain("Na criação: 2 Triunfos, ou 1 Triunfo e 2 Distinções (p. 90)");
  });

  it("keeps the v4 catalog and pairs, rejecting v5-only perks on v4", () => {
    expect(hunterTemplateCreationProblems(v4, legacy)).toEqual([]);
    expect(hunterTemplateCreationProblems(v4, { ...legacy, pedra_toque_1: "" })).not.toEqual([]);
    expect(
      hunterTemplateCreationProblems(v4, { ...legacy, distincoes: ["Arsenal: Exóticas"] }),
    ).not.toEqual([]);
    expect(
      hunterTemplateCreationProblems(v5.template, { ...legacy, pilares: ["Clara"] }),
    ).not.toEqual([]);
  });

  it("rejects unsupported edges, duplicate picks, missing parent edges and excessive pillars", () => {
    const base = {
      ...identity,
      triunfos: ["Arsenal"],
      distincoes: ["Arsenal: Exóticas", "Arsenal: Irrastreável"],
    };
    const patches: Array<Record<string, FieldValue>> = [
      { triunfos: ["Vira-Casaca", "Purificar o Sobrenatural"], distincoes: [] },
      { triunfos: ["Arsenal", "Arsenal"], distincoes: [] },
      { distincoes: ["Frota: Armadura", "Arsenal: Irrastreável"] },
      { pilares: ["a", "b", "c", "d"] },
      { pilares: ["x".repeat(161)] },
    ];
    for (const patch of patches)
      expect(hunterTemplateCreationProblems(v5.template, { ...base, ...patch })).not.toEqual([]);
    expect(hunterTemplateCreationProblems({ ...v5.template, system_key: "custom" }, {})).toEqual(
      [],
    );
  });
});

describe("Caçador: salvamento pelo assistente mobile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    state.mode = "local";
    state.templates = [];
  });
  afterEach(() => vi.restoreAllMocks());

  // Keep the real Hunter fields; omit attribute/skill budgets to isolate the missing system check.
  function review(template: SheetTemplate, values: Record<string, FieldValue>) {
    const ids = new Set([
      "nome",
      "credo",
      "impulso",
      "triunfos",
      "distincoes",
      "pilares",
      "conviccao_1",
      "pedra_toque_1",
    ]);
    const schema = {
      ...template,
      fields: template.fields.filter((field) => ids.has(field.id)),
      creation_rules: [],
    };
    vi.spyOn(SYSTEM_STARTERS, "map").mockReturnValue([
      { ...v5, template: schema, values, templateId: null, systemKey: "hunter" },
    ]);
    const Component = Route.options.component!;
    render(<Component />);
    fireEvent.click(screen.getByRole("button", { name: /Caçador/ }));
    fireEvent.click(screen.getByRole("button", { name: /Revis/ }));
  }

  it.each([
    [
      "v5 invalid 2+1",
      v5.template,
      { ...identity, triunfos: ["Arsenal", "Frota"], distincoes: ["Arsenal: Exóticas"] },
      false,
    ],
    [
      "v5 valid 2+0",
      v5.template,
      { ...identity, triunfos: ["Arsenal", "Frota"], distincoes: [] },
      true,
    ],
    ["v4 valid legacy 2+1", v4, legacy, true],
  ] satisfies Array<[string, SheetTemplate, Record<string, FieldValue>, boolean]>)(
    "%s",
    async (_name, template, values, valid) => {
      review(template, values);
      fireEvent.click(screen.getByRole("button", { name: "Criar personagem" }));
      if (valid) await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
      else {
        expect(
          await screen.findByText("Na criação: 2 Triunfos, ou 1 Triunfo e 2 Distinções (p. 90)"),
        ).toBeInTheDocument();
        expect(state.create).not.toHaveBeenCalled();
      }
    },
  );
});
