import type { FieldValue, PowerPicksRule, SelectGrantsRule, SheetField, SheetTemplate } from "@/lib/sheet-template.ts";
import { activeGrants, choiceOptions, chosenOption, powerItem, powerStatus, selectedCase } from "@/lib/creation-grants.ts";
import { Btn } from "./ui";

type Values = Record<string, FieldValue>;
type OnChange = (id: string, value: FieldValue | undefined) => void;

/** What the chosen clan and predator already put on the sheet, with a button for their picks. */
export function GrantSummary({ template, values, onPick }: { template: SheetTemplate; values: Values; onPick: (ruleId: string) => void }) {
  const labels = new Map(template.fields.map((field) => [field.id, field.label]));
  const entries = activeGrants(template, values).filter((entry) => entry.case);
  if (!entries.length) return null;
  return (
    <div className="space-y-2 sm:col-span-2">
      {entries.map((entry) => {
        const lines = entry.grants.flatMap((grant) => [
          ...Object.entries(grant.add ?? {}).map(([id, amount]) => `${labels.get(id) ?? id} ${amount > 0 ? "+" : ""}${amount}`),
          ...Object.values(grant.items ?? {}).flat(),
        ]);
        const hasChoices = (entry.case?.choices?.length ?? 0) > 0;
        return (
          <div key={entry.rule.id} className="parchment-inset p-3 text-sm text-ink">
            <p className="font-semibold">{entry.rule.label}: {entry.case?.equals}</p>
            {lines.length > 0 && <ul className="mt-1 list-disc pl-5">{lines.map((line) => <li key={line}>{line}</li>)}</ul>}
            {entry.missing.length > 0 && <p className="mt-1 text-xs font-semibold text-destructive">Falta escolher: {entry.missing.map((choice) => choice.label.toLowerCase()).join(", ")}.</p>}
            {hasChoices && <Btn variant="outline" size="sm" className="mt-2" onClick={() => onPick(entry.rule.id)}>{entry.missing.length ? "Escolher bônus" : "Alterar escolhas"}</Btn>}
          </div>
        );
      })}
    </div>
  );
}

/** Modal picker for the choices of the selected case (predator bonus discipline and specialty, Caitiff disciplines). */
export function GrantPicker({ rule, values, onChange, onClose }: { rule: SelectGrantsRule; values: Values; onChange: OnChange; onClose: () => void }) {
  const item = selectedCase(rule, values);
  if (!item?.choices?.length) return null;
  const missing = item.choices.filter((choice) => !chosenOption(choice, values)).length;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="grant-picker-title" className="parchment max-h-[85vh] w-full max-w-lg overflow-y-auto p-4"
        onKeyDown={(event) => { if (event.key === "Escape") onClose(); }}>
        <h2 id="grant-picker-title" className="text-lg font-semibold text-ink">{item.equals}: escolha os bônus</h2>
        <p className="mt-1 text-sm text-ink-muted">Os demais bônus já foram aplicados à ficha.</p>
        {item.choices.map((choice) => (
          <fieldset key={choice.field} className="mt-3">
            <legend className="mb-1 text-sm font-semibold text-ink">{choice.label}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {choiceOptions(choice, values).map((option) => (
                <label key={option.label} className={`tap flex cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm text-ink ${values[choice.field] === option.label ? "border-primary bg-parchment-deep" : "border-ink/20"}`}>
                  <input type="radio" name={`grant-${choice.field}`} className="size-4 accent-primary" checked={values[choice.field] === option.label}
                    onChange={() => onChange(choice.field, option.label)} />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="mt-4 flex justify-end">
          <Btn autoFocus onClick={onClose}>{missing ? "Escolher depois" : "Confirmar"}</Btn>
        </div>
      </div>
    </div>
  );
}

/** Locked power list: one pick per dot, up to the discipline's level. */
export function PowerPicker({ field, rule, values, onChange, error, idPrefix }: { field: SheetField; rule: PowerPicksRule; values: Values; onChange: OnChange; error?: string | undefined; idPrefix: string }) {
  const raw = values[field.id];
  const chosen = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  const statuses = powerStatus(rule, values).filter((status) => status.allowed > 0);
  // Nothing to pick (no sorcery for rituals, no clan yet): the list stays off the step.
  if (statuses.length === 0) return null;
  return (
    <fieldset id={`${idPrefix}-${field.id}`} tabIndex={-1} className="sm:col-span-2">
      <legend className="mb-1 text-sm font-semibold text-ink">{field.label}</legend>
      <div className="space-y-3">
        {statuses.map((status) => {
          const full = status.chosen.length >= status.allowed;
          return (
            <section key={status.source.field} aria-label={status.source.label} className="parchment-inset p-3">
              <h3 className="text-sm font-semibold text-ink">{status.source.label} <span className="font-normal text-ink-muted">{status.chosen.length} de {status.allowed} · até o nível {status.maxLevel}</span></h3>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {status.available.map((power) => {
                  const item = powerItem(status.source, power);
                  const checked = chosen.includes(item);
                  return (
                    <label key={item} className={`tap flex items-center gap-2 rounded-lg border px-3 text-sm text-ink ${checked ? "border-primary bg-parchment-deep" : "border-ink/20"} ${!checked && full ? "opacity-50" : "cursor-pointer"}`}>
                      <input type="checkbox" className="size-4 accent-primary" checked={checked} disabled={!checked && full}
                        onChange={(event) => onChange(field.id, event.target.checked ? [...chosen, item] : chosen.filter((entry) => entry !== item))} />
                      <span className="flex-1">{power.name}</span><small className="text-ink-muted">Nível {power.level}</small>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-destructive">{error}</p>}
    </fieldset>
  );
}
