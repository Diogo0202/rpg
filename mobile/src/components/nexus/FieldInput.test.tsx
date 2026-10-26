import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldInput } from "./FieldInput";
import { HUNTER_LIMITS, HUNTER_TRAIT_FIELDS } from "@/lib/hunter-traits.ts";
import { validateFields } from "@/lib/sheet-creation.ts";
import type { FieldValue, SheetField, SheetTemplate } from "@/lib/sheet-template.ts";

const skills: SheetField = {
  id: "pericias", label: "Perícias favorecidas", kind: "collection", required: false, options: [], expression: null,
  min_items: 2, max_items: 2, item_options: ["Atletismo", "Furtividade", "Ofício"],
};
const tags: SheetField = { id: "marcas", label: "Marcas", kind: "collection", required: false, options: [], expression: null, max_items: 1, max_length: 12 };
const template = { name: "Caçador v3", version: 3, fields: [...HUNTER_TRAIT_FIELDS, skills, tags] } as SheetTemplate;

/** Mirrors the creation wizard: errors per field, cleared for the field and its pair on change. */
function Form({ initial = {} }: { initial?: Record<string, FieldValue> }) {
  const [values, setValues] = useState<Record<string, FieldValue>>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const onChange = (id: string, value: FieldValue | undefined) => {
    setValues((current) => { const next = { ...current }; if (value === undefined) delete next[id]; else next[id] = value; return next; });
    setErrors((current) => { const next = { ...current }; delete next[id]; for (const f of template.fields) if (f.paired_with === id) delete next[f.id]; return next; });
  };
  return <form>
    {template.fields.map((field) => <FieldInput key={field.id} template={template} field={field} values={values} error={errors[field.id]} onChange={onChange} idPrefix="t" />)}
    <button type="button" onClick={() => setErrors(validateFields(template.fields, values, template))}>Validar</button>
  </form>;
}

describe("FieldInput structured limits (Caçador v3)", () => {
  it("caps text at max_length with a counter and keeps imported overflow visible for the error", () => {
    render(<Form initial={{ conviccao_2: "x".repeat(HUNTER_LIMITS.conviccao + 5), pedra_toque_2: "Irmã" }} />);
    const first = screen.getByLabelText(/^Convicção 1/);
    expect(first).toHaveAttribute("maxLength", String(HUNTER_LIMITS.conviccao));
    fireEvent.change(first, { target: { value: "Proteger os inocentes" } });
    expect(screen.getByText(`21/${HUNTER_LIMITS.conviccao}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Validar" }));
    expect(screen.getByText(`Use até ${HUNTER_LIMITS.conviccao} caracteres.`)).toBeInTheDocument();
  });

  it("asks for both halves of a Convicção / Pedra de Toque pair and clears the error from the partner", () => {
    render(<Form />);
    expect(screen.getAllByText("Preencha junto com Pedra de Toque 2.")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/^Convicção 1/), { target: { value: "Nunca abandonar a célula" } });
    fireEvent.change(screen.getByLabelText(/^Pedra de Toque 1/), { target: { value: "Rosa" } });
    fireEvent.change(screen.getByLabelText(/^Convicção 2/), { target: { value: "Vingar meu irmão" } });
    // The empty partner now shows as needed.
    expect(screen.getByLabelText(/^Pedra de Toque 2/).closest("div")?.querySelector("label")?.textContent).toContain("*");
    fireEvent.click(screen.getByRole("button", { name: "Validar" }));
    const conviction = screen.getByLabelText(/^Convicção 2/);
    expect(conviction).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Preencha também Pedra de Toque 2.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Pedra de Toque 2/), { target: { value: "Daniel" } });
    expect(screen.queryByText("Preencha também Pedra de Toque 2.")).toBeNull();
    expect(conviction).toHaveAttribute("aria-invalid", "false");
  });

  it("picks closed-list items through a select, honouring min and max items", () => {
    render(<Form initial={{ conviccao_1: "a", pedra_toque_1: "b" }} />);
    const picker = screen.getByLabelText(/^Perícias favorecidas/);
    expect(picker.tagName).toBe("SELECT");
    fireEvent.change(picker, { target: { value: "Ofício" } });
    expect(screen.getByText("1 escolhidos · de 2 a 2 itens")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Validar" }));
    expect(screen.getByText("Adicione ao menos 2 itens.")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Ofício" })).toBeNull();
    fireEvent.change(picker, { target: { value: "Atletismo" } });
    expect(picker).toBeDisabled();
    expect(screen.queryByText("Adicione ao menos 2 itens.")).toBeNull();
  });

  it("limits free collections by max_items and max_length per item", () => {
    render(<Form />);
    const input = screen.getByLabelText(/^Marcas/);
    expect(input).toHaveAttribute("maxLength", "12");
    fireEvent.change(input, { target: { value: "Cicatriz" } });
    fireEvent.click(screen.getByRole("button", { name: "Adicionar em Marcas" }));
    expect(screen.getByText("Cicatriz")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Marcas/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Adicionar em Marcas" })).toBeDisabled();
  });
});
