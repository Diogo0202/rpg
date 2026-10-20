import { useState } from "react";
import { X } from "lucide-react";
import type { FieldValue, SheetField, SheetTemplate } from "@/lib/sheet-template.ts";
import { fieldOptions, isFieldActive } from "@/lib/sheet-creation.ts";
import type { FormulaResult } from "@/lib/formula";
import { Btn } from "./ui";

type Props = {
  template: SheetTemplate;
  field: SheetField;
  values: Record<string, FieldValue>;
  error?: string | undefined;
  formula?: FormulaResult | undefined;
  onChange: (id: string, value: FieldValue | undefined) => void;
  idPrefix?: string;
};

export function FieldInput({ template, field, values, error, formula, onChange, idPrefix = "f" }: Props) {
  const id = `${idPrefix}-${field.id}`;
  const errId = `${id}-err`;
  const value = values[field.id];
  if (!isFieldActive(template, field, values)) return null;
  const describedBy = error ? errId : undefined;
  const label = (
    <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
      {field.label}{field.required && <span className="text-destructive" aria-hidden> *</span>}
    </label>
  );
  const err = error ? <p id={errId} className="mt-1 text-xs font-semibold text-destructive">{error}</p> : null;

  if (field.kind === "formula" || field.kind === "roll") {
    return (
      <div>
        <p className="mb-1 block text-sm font-semibold text-ink">{field.label}</p>
        <output id={id} className="parchment-inset flex min-h-11 items-center justify-between px-3 text-ink" aria-label={`${field.label}, calculado`}>
          <span className="text-lg font-bold">{formula?.ok ? formula.value : "—"}</span>
          <span className="text-xs text-ink-muted">{formula && !formula.ok ? formula.error : `= ${field.expression}`}</span>
        </output>
      </div>
    );
  }
  if (field.kind === "checkbox") {
    return (
      <div>
        <label htmlFor={id} className="tap flex cursor-pointer items-center gap-3 text-sm font-semibold text-ink">
          <input id={id} type="checkbox" className="size-5 accent-primary" checked={value === true} onChange={(e) => onChange(field.id, e.target.checked)} aria-describedby={describedBy} />
          {field.label}
        </label>
        {err}
      </div>
    );
  }
  if (field.kind === "number") {
    return (
      <div>
        {label}
        <input id={id} type="number" inputMode="numeric" className="field-input" value={typeof value === "number" ? value : ""}
          aria-invalid={!!error} aria-describedby={describedBy}
          onChange={(e) => onChange(field.id, e.target.value === "" ? undefined : Number(e.target.value))} />
        {err}
      </div>
    );
  }
  if (field.kind === "select") {
    const options = fieldOptions(template, field, values);
    const stale = typeof value === "string" && value !== "" && !options.includes(value);
    return (
      <div>
        {label}
        <select id={id} className="field-input" value={typeof value === "string" ? value : ""} aria-invalid={!!error || stale} aria-describedby={describedBy}
          onChange={(e) => onChange(field.id, e.target.value === "" ? "" : e.target.value)}>
          <option value="">Escolha…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {stale && <p className="mt-1 text-xs font-semibold text-destructive">Valor incompatível — revise.</p>}
        {err}
      </div>
    );
  }
  if (field.kind === "collection") return <CollectionInput id={id} field={field} value={Array.isArray(value) ? value : []} onChange={onChange} error={error} />;
  const long = ["notas", "ambicao", "desejo", "apoiadores"].includes(field.id);
  return (
    <div>
      {label}
      {long ? (
        <textarea id={id} className="field-input min-h-20" value={typeof value === "string" ? value : ""} maxLength={10000}
          aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(field.id, e.target.value)} />
      ) : (
        <input id={id} type="text" className="field-input" value={typeof value === "string" ? value : ""} maxLength={field.character_name ? 120 : 10000}
          aria-invalid={!!error} aria-describedby={describedBy} onChange={(e) => onChange(field.id, e.target.value)} />
      )}
      {err}
    </div>
  );
}

function CollectionInput({ id, field, value, onChange, error }: { id: string; field: SheetField; value: string[]; onChange: Props["onChange"]; error?: string | undefined }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t || value.includes(t) || value.length >= 200) return;
    onChange(field.id, [...value, t.slice(0, 500)]); setDraft("");
  };
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">{field.label}</label>
      <div className="flex gap-2">
        <input id={id} className="field-input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={500}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Adicionar item" />
        <Btn variant="ink" onClick={add} aria-label={`Adicionar em ${field.label}`}>+</Btn>
      </div>
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {value.map((item) => (
            <li key={item} className="inline-flex items-center gap-1 rounded-full bg-parchment-deep pl-3 text-sm text-ink">
              {item}
              <button type="button" className="tap inline-flex items-center justify-center rounded-full" aria-label={`Remover ${item}`}
                onClick={() => onChange(field.id, value.filter((v) => v !== item))}><X className="size-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
    </div>
  );
}

