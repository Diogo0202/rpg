import { useState } from "react";
import { X } from "lucide-react";
import type { FieldValue, SheetField, SheetTemplate } from "@/lib/sheet-template.ts";
import { fieldOptions, isFieldActive } from "@/lib/sheet-creation.ts";
import { collectionPointRules, collectionPointStatus } from "@/lib/creation-grants.ts";
import { specialtyRules, specialtyStatus } from "@/lib/creation-checks.ts";
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
  /** Number decided by a creation rule (clan and predator); shown read-only. */
  fixed?: number | undefined;
  /** Collection items a creation rule grants; listed but not removable. */
  lockedItems?: string[] | undefined;
  /** Why `fixed` is read-only; defaults to the clan and predator grants. */
  fixedNote?: string | undefined;
};

/** Point count, catalog and specialty hints for collections with creation rules (same text as the web wizard). */
function collectionHints(template: SheetTemplate, field: SheetField, values: Record<string, FieldValue>, locked: string[]) {
  const lines: string[] = [];
  const pointRule = collectionPointRules(template).find((rule) => rule.collection === field.id);
  if (pointRule) {
    const points = collectionPointStatus(template, pointRule, values);
    const labels = new Map(template.fields.map((item) => [item.id, item.label]));
    lines.push(`${points.spent} de ${pointRule.points} pontos${pointRule.fields.length ? ` (inclui ${pointRule.fields.map((id) => labels.get(id) ?? id).join(", ")})` : ""}. Marque os pontos com • ou (2).`);
  }
  const specialtyRule = specialtyRules(template).find((rule) => rule.collection === field.id);
  if (specialtyRule) {
    const status = specialtyStatus(specialtyRule, values, locked);
    lines.push(`${status.own.length} de ${status.expected} especializações gratuitas${status.due.length ? ` (uma em ${status.due.join(", ")}, mais ${specialtyRule.free} livre)` : ""}. Formato: Habilidade (especialização).`);
  }
  // Catalog items are offered with their dots so the point count reads them.
  const catalog = (pointRule?.catalog ?? []).flatMap((entry) => entry.costs.map((cost) => `${entry.name} ${"•".repeat(cost)}`));
  return { lines, catalog, homebrew: pointRule?.allow_homebrew === true };
}

export function FieldInput({ template, field, values, error, formula, onChange, idPrefix = "f", fixed, lockedItems, fixedNote }: Props) {
  const id = `${idPrefix}-${field.id}`;
  const errId = `${id}-err`;
  const value = values[field.id];
  if (!isFieldActive(template, field, values)) return null;
  // Paired fields (Convicção and Pedra de Toque) are filled together: one asks for the other.
  const partner = field.paired_with ? template.fields.find((item) => item.id === field.paired_with) : undefined;
  const partnerFilled = partner ? filledText(values[partner.id]) : false;
  const needed = field.required || (partnerFilled && !filledText(value));
  const hintId = `${id}-hint`;
  const hint = partner ? <p id={hintId} className="mt-1 text-xs text-ink-muted">Preencha junto com {partner.label}.</p> : null;
  const describedBy = [error ? errId : "", partner ? hintId : ""].filter(Boolean).join(" ") || undefined;
  const label = (
    <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
      {field.label}{needed && <span className="text-destructive" aria-hidden> *</span>}
      {field.private && <span className="ml-2 text-xs font-normal text-ink-muted">privado: só você e o Mestre</span>}
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
  if (field.kind === "number" && fixed !== undefined) {
    return (
      <div>
        <p className="mb-1 block text-sm font-semibold text-ink">{field.label}</p>
        <output id={id} className="parchment-inset flex min-h-11 items-center justify-between px-3 text-ink" aria-label={`${field.label}, ${(fixedNote ?? "Definido pelo clã e predador").toLowerCase()}`}>
          <span className="text-lg font-bold">{fixed}</span>
          <span className="text-xs text-ink-muted">{fixedNote ?? "Definido pelo clã e predador"}</span>
        </output>
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
  if (field.kind === "collection") {
    const items = Array.isArray(value) ? value : [];
    const locked = lockedItems ?? [];
    return <CollectionInput id={id} field={field} value={items} locked={locked} onChange={onChange} error={error}
      rules={collectionHints(template, field, values, locked)} />;
  }
  const long = ["notas", "ambicao", "desejo", "apoiadores"].includes(field.id);
  const text = typeof value === "string" ? value : "";
  const limit = typeof field.max_length === "number" ? field.max_length : field.character_name ? 120 : 10000;
  // Declared limits show a counter; values imported past the limit stay visible for the error to name.
  const counter = typeof field.max_length === "number"
    ? <p className={`mt-1 text-right text-xs ${text.length > field.max_length ? "font-semibold text-destructive" : "text-ink-muted"}`} aria-live="polite">{text.length}/{field.max_length}</p>
    : null;
  return (
    <div>
      {label}
      {long ? (
        <textarea id={id} className="field-input min-h-20" value={text} maxLength={Math.max(limit, text.length)}
          aria-invalid={!!error} aria-describedby={describedBy} aria-required={needed || undefined} onChange={(e) => onChange(field.id, e.target.value)} />
      ) : (
        <input id={id} type="text" className="field-input" value={text} maxLength={Math.max(limit, text.length)}
          aria-invalid={!!error} aria-describedby={describedBy} aria-required={needed || undefined} onChange={(e) => onChange(field.id, e.target.value)} />
      )}
      {counter}
      {hint}
      {err}
    </div>
  );
}

function filledText(value: FieldValue | undefined): boolean {
  return typeof value === "string" && Boolean(value.trim());
}

function CollectionInput({ id, field, value, locked, onChange, error, rules }: { id: string; field: SheetField; value: string[]; locked: string[]; onChange: Props["onChange"]; error?: string | undefined; rules: ReturnType<typeof collectionHints> }) {
  const [draft, setDraft] = useState("");
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const itemLimit = typeof field.max_length === "number" ? field.max_length : 500;
  const maxItems = typeof field.max_items === "number" ? field.max_items : 200;
  const closed = Array.isArray(field.item_options) ? field.item_options : null;
  const available = closed ? closed.filter((option) => !value.includes(option)) : [];
  const full = value.length >= maxItems;
  const add = (raw = draft) => {
    const t = raw.trim();
    if (!t || value.includes(t) || full) return;
    if (closed && !closed.includes(t)) return;
    onChange(field.id, [...value, t.slice(0, itemLimit)]); setDraft("");
  };
  const range = typeof field.min_items === "number" && typeof field.max_items === "number"
    ? `de ${field.min_items} a ${field.max_items} itens`
    : typeof field.max_items === "number" ? `até ${field.max_items} itens`
    : typeof field.min_items === "number" ? `ao menos ${field.min_items} itens` : "";
  const hint = [range && `${value.length} escolhidos · ${range}`, typeof field.max_length === "number" && !closed ? `até ${field.max_length} caracteres cada` : ""].filter(Boolean).join(" · ");
  const describedBy = [error ? errId : "", hint ? hintId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">{field.label}{field.required && <span className="text-destructive" aria-hidden> *</span>}</label>
      {closed ? (
        // Closed list: only the model's options can be picked, once each.
        <select id={id} className="field-input" value="" disabled={full || available.length === 0} aria-invalid={!!error} aria-describedby={describedBy}
          onChange={(e) => add(e.target.value)}>
          <option value="">{full ? "Limite de itens atingido" : "Escolher item…"}</option>
          {available.map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      ) : (
        <div className="flex gap-2">
          <input id={id} className="field-input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={itemLimit} disabled={full}
            aria-invalid={!!error} aria-describedby={describedBy}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={full ? "Limite de itens atingido" : "Adicionar item"} />
          <Btn variant="ink" onClick={() => add()} disabled={full} aria-label={`Adicionar em ${field.label}`}>+</Btn>
        </div>
      )}
      {!closed && rules.catalog.length > 0 && (
        <select className="field-input mt-2" value="" disabled={full} aria-label={`Catálogo de ${field.label}`}
          onChange={(e) => add(e.target.value)}>
          <option value="">{rules.homebrew ? "Do catálogo (o narrador aceita itens da casa)…" : "Do catálogo do modelo…"}</option>
          {rules.catalog.filter((option) => !value.includes(option)).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      )}
      {hint && <p id={hintId} className="mt-1 text-xs text-ink-muted">{hint}</p>}
      {rules.lines.map((line) => <p key={line} className="mt-1 text-xs text-ink-muted" aria-live="polite">{line}</p>)}
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {value.map((item) => (
            <li key={item} className="inline-flex items-center gap-1 rounded-full bg-parchment-deep pl-3 text-sm text-ink">
              {item}
              {locked.includes(item)
                ? <span className="px-2 text-xs text-ink-muted">concedido</span>
                : <button type="button" className="tap inline-flex items-center justify-center rounded-full" aria-label={`Remover ${item}`}
                  onClick={() => onChange(field.id, value.filter((v) => v !== item))}><X className="size-4" aria-hidden /></button>}
            </li>
          ))}
        </ul>
      )}
      {error && <p id={errId} className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
    </div>
  );
}

