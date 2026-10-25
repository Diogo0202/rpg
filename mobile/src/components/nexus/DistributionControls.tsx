import { distributionRulesFor, matchingDistribution, tallyDistribution } from "@/lib/creation-distributions";
import type { FieldValue, SheetTemplate } from "@/lib/sheet-template";

export function distributionProblems(template: SheetTemplate, values: Record<string, FieldValue>, ids: Iterable<string>, choices: Record<string, number>): string[] {
  return distributionRulesFor(template, ids).flatMap((rule) => {
    const index = rule.options.length === 1 ? 0 : choices[rule.id] ?? matchingDistribution(rule, values);
    const option = rule.options[index];
    if (!option) return [`Escolha um modo de ${rule.label}.`];
    const tally = tallyDistribution(rule, option, values);
    return tally.complete ? [] : [`${rule.label}: complete a distribuição ${option.label}.`];
  });
}

export function DistributionControls({ template, values, ids, choices, onChoose }: {
  template: SheetTemplate; values: Record<string, FieldValue>; ids: Iterable<string>;
  choices: Record<string, number>; onChoose: (id: string, option: number) => void;
}) {
  return <div className="space-y-3">{distributionRulesFor(template, ids).map((rule) => {
    const selected = rule.options.length === 1 ? 0 : choices[rule.id] ?? matchingDistribution(rule, values);
    const option = rule.options[selected];
    const tally = option ? tallyDistribution(rule, option, values) : null;
    return <fieldset key={rule.id} className="parchment-inset mb-3 min-w-0 space-y-2 p-3">
      <legend className="font-semibold">Distribuição de {rule.label}</legend>
      {rule.options.length > 1 && rule.options.map((item, index) => <label key={item.label} className="tap flex items-start gap-2 text-sm">
        <input type="radio" name={`distribution-${rule.id}`} checked={selected === index} onChange={() => onChoose(rule.id, index)} />
        <span>{item.label}: {Object.entries(item.counts).sort(([a], [b]) => Number(b) - Number(a)).map(([value, count]) => `${count} em ${value}`).join(", ")}</span>
      </label>)}
      {tally && <div role="status" aria-live="polite" className="space-y-1 text-sm">
        {tally.slots.map((slot) => <p key={slot.value}>{slot.have}/{slot.need} {slot.rest ? "sem pontos" : `com ${slot.value} pontos`}{slot.have > slot.need ? " (excesso)" : slot.have < slot.need ? ` (faltam ${slot.need - slot.have})` : " (completo)"}</p>)}
        {tally.outside.length > 0 && <p>Há valores fora desta distribuição.</p>}
        <p className="font-semibold">{tally.complete ? "Distribuição completa." : "Revise os pontos antes de avançar."}</p>
      </div>}
    </fieldset>;
  })}</div>;
}
