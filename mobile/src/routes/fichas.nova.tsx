import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SYSTEM_STARTERS, type SystemStarter } from "@/lib/system-starters.ts";
import type { FieldValue, SheetField, SheetTemplate } from "@/lib/sheet-template.ts";
import { creationGroups, creationStepLabel, identityFields, reconcileDependentValues, validateFields, characterNameField } from "@/lib/sheet-creation.ts";
import { FieldInput } from "@/components/nexus/FieldInput";
import { GrantPicker, GrantSummary, PowerPicker } from "@/components/nexus/CreationGrants";
import { applyGrants, creationRuleViolations, grantChoiceFieldIds, grantedItems, grantedNumbers, grantProblems, grantRules, powerRules, ruleMessage, selectedCase, staleGrantChoices } from "@/lib/creation-grants.ts";
import { Btn, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";
import { computeFormulas, focusSheetError, IDENTITY_LABELS, prepareSheetValues, wizardTransition } from "@/lib/nexus/sheets";
import { useNexus } from "@/lib/nexus/store";
import type { JsonValue } from "@/lib/mobile-sync/index.ts";
import { makeSheetStarter } from "@/lib/nexus/remote-adapter";
import { DistributionControls, distributionProblems } from "@/components/nexus/DistributionControls";
import { distributionRulesFor, matchingDistribution } from "@/lib/creation-distributions";
import { HUNTER_STEP_HELP } from "@/lib/hunter-creation-data";

export const Route = createFileRoute("/fichas/nova")({
  head: () => ({
    meta: [
      { title: "Nova ficha guiada — RPG-Atlas Mobile" },
      { name: "description", content: "Assistente guiado para criar fichas de Vampiro V5, Caçador e O Um Anel." },
      { property: "og:title", content: "Nova ficha guiada — RPG-Atlas Mobile" },
      { property: "og:description", content: "Assistente guiado para criar fichas de Vampiro V5, Caçador e O Um Anel." },
    ],
  }),
  component: NewSheet,
});

function NewSheet() {
  const { mode, list } = useNexus();
  const [starter, setStarter] = useState<WizardStarter | null>(null);
  const templates = useMemo(() => {
    if (mode === "local") return SYSTEM_STARTERS.map((item) => ({ ...item, templateId: null as string | null, systemKey: item.id }));
    return list<Record<string, JsonValue>>("system_templates")
      .filter((row) => row.data.status === "approved" && typeof row.data.name === "string" && typeof row.data.version === "number")
      .map((row) => makeSheetStarter({ id: row.id, name: String(row.data.name), version: Number(row.data.version), schema: row.data.schema ?? {} }))
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [list, mode]);
  return (
    <>
      <PageHeader title="Nova ficha" subtitle="Assistente guiado. Modelos-base parciais; regras completas dependem das fontes oficiais." />
      <LocalGate>
        {starter ? <Wizard starter={starter} onCancel={() => setStarter(null)} /> : templates.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {templates.map((s) => (
              <Btn key={s.id} variant="outline" onClick={() => setStarter(s)} className="parchment flex h-auto flex-col items-start bg-card p-4 text-left hover:ring-2 hover:ring-ring">
                <p className="font-display text-xl font-semibold text-ink">{s.label}</p>
                <p className="mt-1 text-sm text-ink-muted">{s.template.name} · {s.template.fields.length} campos</p>
              </Btn>
            ))}
          </div>
        ) : <p className="parchment p-4 text-sm text-ink-muted">{mode === "connected" ? "Esta campanha não tem modelos aprovados compatíveis para criar fichas." : "Nenhum modelo local está disponível."}</p>
        }
      </LocalGate>
    </>
  );
}

type WizardStarter = { id: string; label: string; systemKey: string; templateId: string | null; template: SheetTemplate; values: Record<string, FieldValue> };

function Wizard({ starter, onCancel }: { starter: WizardStarter; onCancel: () => void }) {
  const template = starter.template;
  const { create, mode } = useNexus();
  const navigate = useNavigate();
  // Templates from the server start empty; the base grants (Humanity 7, disciplines at 0) land at once.
  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({ ...starter.values, ...applyGrants(template, starter.values, starter.values) }));
  const [problems, setProblems] = useState<string[]>([]);
  const [picker, setPicker] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [distributionChoices, setDistributionChoices] = useState<Record<string, number>>({});
  const nameField = characterNameField(template);
  const choiceFieldIds = useMemo(() => grantChoiceFieldIds(template), [template]);
  const idFields = identityFields(template).filter((field) => !choiceFieldIds.has(field.id));
  const labels = useMemo(() => new Map(template.fields.map((field) => [field.id, field.label])), [template]);
  const pickRules = useMemo(() => new Map(powerRules(template).map((rule) => [rule.collection, rule])), [template]);
  const enforced = grantedNumbers(template, values).enforced;
  const lockedItems = grantedItems(template, values);
  const groups = creationGroups(template);
  const steps = useMemo(() => [
    { key: "identity", label: creationStepLabel("identity"), fields: [...(nameField ? [nameField] : []), ...idFields] },
    ...groups.map((g) => ({ key: g.step, label: creationStepLabel(g.step), fields: g.fields })),
    { key: "review", label: "Revisão", fields: [] },
  ], [template]); // eslint-disable-line react-hooks/exhaustive-deps
  const [step, setStep] = useState(0);
   const current = steps[step] ?? steps[0];
   if (!current) return null;
  const formulas = computeFormulas(template, values);
  const currentIds = current.fields.map((field) => field.id);
  const pendingDistributionIds = new Set(distributionRulesFor(template, currentIds)
    .filter((rule) => rule.options.length > 1 && (distributionChoices[rule.id] ?? matchingDistribution(rule, values)) < 0)
    .flatMap((rule) => rule.fields));

  const onChange = (id: string, v: FieldValue | undefined) => {
    const next = { ...values };
    if (v === undefined) delete next[id]; else next[id] = v;
    const r = reconcileDependentValues(template, next);
    // Clan and predator packages land on the sheet at once; the picks they offer open in a picker.
    const granted = { ...r.values, ...applyGrants(template, values, r.values) };
    for (const stale of staleGrantChoices(template, granted)) delete granted[stale];
    setRemoved(r.removedIds.filter((rid) => values[rid] !== undefined && r.values[rid] === undefined));
    setValues(granted);
    setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
    setProblems([]);
    const opened = grantRules(template).find((rule) => rule.field === id && values[id] !== v && (selectedCase(rule, granted)?.choices?.length ?? 0) > 0);
    if (opened) setPicker(opened.id);
  };

  const focusProblems = () => requestAnimationFrame(() => document.getElementById("nova-regras")?.focus());

  /** Clan, predator and power checks plus the point distributions that live on these fields. */
  const stepProblems = (fields: SheetField[]) => {
    const ids = new Set(fields.map((field) => field.id));
    return [
      ...distributionProblems(template, values, ids, distributionChoices),
      ...grantProblems(template, values, ids, labels),
      ...creationRuleViolations(template, values)
        .filter((rule) => rule.type !== "select_grants" && rule.type !== "power_picks" && rule.fields.some((fieldId) => ids.has(fieldId)))
        .map(ruleMessage),
    ];
  };

  const goTo = (target: number) => {
    const result = wizardTransition(steps, step, target, values, template);
    if (target > step && !Object.keys(result.errors).length) {
      for (let i = 0; i < Math.min(target, steps.length - 1); i++) {
        const found = stepProblems(steps[i]?.fields ?? []);
        if (found.length) { setErrors({}); setProblems(found); setStep(i); focusProblems(); return; }
      }
    }
    setProblems([]);
    setErrors(result.errors);
    setStep(result.step);
    focusSheetError("nova", result.errors);
  };

  const save = async () => {
    const prepared = prepareSheetValues(template, values, "");
    const all = prepared.errors;
    if (Object.keys(all).length) {
      setErrors(all);
      const invalidStep = steps.findIndex((s) => s.fields.some((f) => all[f.id]));
      if (invalidStep >= 0) setStep(invalidStep);
      focusSheetError("nova", all); toast.error("Há campos para revisar."); return;
    }
    // The database refuses a sheet that breaks a creation rule; say why before it syncs.
    const violations = creationRuleViolations(template, prepared.values);
    if (violations.length) {
      setProblems(violations.map(ruleMessage));
      const invalidStep = steps.findIndex((s) => s.fields.some((f) => violations.some((rule) => rule.fields.includes(f.id) || ("field" in rule && rule.field === f.id) || ("collection" in rule && rule.collection === f.id))));
      if (invalidStep >= 0) setStep(invalidStep);
      focusProblems(); toast.error("A ficha não segue as regras de criação."); return;
    }
    setSaving(true);
    try {
      const stored = mode === "connected" ? prepared.values : { ...prepared.values, ativo_na_sessao: true };
      const name = prepared.name;
      const payload: Record<string, JsonValue> = mode === "connected"
        ? { template_id: starter.templateId!, name, values: stored as Record<string, JsonValue> }
        : { name, system_key: starter.systemKey, template_name: template.name, template_version: template.version, values: stored as Record<string, JsonValue>, effects: [] };
      const id = await create("character_sheets", payload);
      toast.success(mode === "connected" ? "Ficha na fila local; a API confirma após sincronização." : "Ficha salva neste aparelho e selecionada na sessão.");
      void navigate({ to: "/fichas", search: { ficha: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally { setSaving(false); }
  };

  const identityKinds = current.key === "identity"
    ? Object.entries(IDENTITY_LABELS).filter(([k]) => idFields.some((f) => f.identity_kind === k)).map(([, l]) => l) : [];

  return (
    <div className="space-y-4">
      <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Etapas">
        {steps.map((s, i) => (
          <li key={s.key}>
            <Btn variant="ghost" onClick={() => goTo(i)}
              aria-current={i === step ? "step" : undefined}
              className={`tap whitespace-nowrap rounded-full px-3 text-xs font-semibold ${i === step ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
              {i + 1}. {s.label}
            </Btn>
          </li>
        ))}
      </ol>
      <Panel title={`${starter.label} · ${current.label}`} actions={identityKinds.map((k) => <Tag key={k} tone="gold">{k}</Tag>)}>
        {template.system_key === "hunter" && HUNTER_STEP_HELP[current.key] && <p className="mb-3 text-sm text-ink-muted">{HUNTER_STEP_HELP[current.key]}</p>}
        {removed.length > 0 && (
          <p className="parchment-inset mb-3 p-3 text-sm text-ink" role="status">Algumas escolhas dependentes foram limpas por incompatibilidade: {removed.join(", ")}. Revise.</p>
        )}
        {problems.length > 0 && (
          <div id="nova-regras" tabIndex={-1} className="parchment-inset mb-3 p-3 text-sm text-ink" role="alert">
            <p className="font-semibold">Regras de criação</p>
            <ul className="mt-1 list-disc pl-5">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          </div>
        )}
        <DistributionControls template={template} values={values} ids={currentIds} choices={distributionChoices}
          onChoose={(id, option) => { setDistributionChoices((previous) => ({ ...previous, [id]: option })); setProblems([]); }} />
        {current.key === "review" ? <Review starter={starter} values={values} formulas={formulas} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {current.fields.map((f) => {
              if (pendingDistributionIds.has(f.id)) return null;
              const fixed = f.kind === "number" ? enforced.get(f.id) : undefined;
              // Disciplines the clan and predator leave at zero stay off the step.
              if (fixed === 0 && f.creation_step === "traits") return null;
              const pickRule = f.kind === "collection" ? pickRules.get(f.id) : undefined;
              if (pickRule) return <PowerPicker key={f.id} field={f} rule={pickRule} values={values} error={errors[f.id]} onChange={onChange} idPrefix="nova" />;
              return <FieldInput key={f.id} template={template} field={f} values={values} error={errors[f.id]} formula={formulas[f.id]} onChange={onChange} idPrefix="nova" fixed={fixed} lockedItems={lockedItems.get(f.id)} />;
            })}
            {current.key === "identity" && <GrantSummary template={template} values={values} onPick={setPicker} />}
          </div>
        )}
      </Panel>
      {picker && (() => {
        const rule = grantRules(template).find((item) => item.id === picker);
        return rule ? <GrantPicker rule={rule} values={values} onChange={onChange} onClose={() => setPicker(null)} /> : null;
      })()}
      <div className="flex flex-wrap justify-between gap-2">
        <Btn variant="forest" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>{step === 0 ? "Trocar sistema" : "Voltar"}</Btn>
        {current.key === "review"
          ? <Btn onClick={() => void save()} disabled={saving}>{saving ? "Salvando…" : "Criar personagem"}</Btn>
           : <Btn onClick={() => goTo(step + 1)}>Avançar</Btn>}
      </div>
    </div>
  );
}

function Review({ starter, values, formulas }: { starter: WizardStarter; values: Record<string, FieldValue>; formulas: ReturnType<typeof computeFormulas> }) {
  const shown = starter.template.fields.filter((f) => values[f.id] !== undefined && values[f.id] !== "" && !(Array.isArray(values[f.id]) && (values[f.id] as string[]).length === 0));
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-muted">Nenhuma rolagem acontece ao salvar. Valores calculados são somente leitura.</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {shown.map((f) => (
          <div key={f.id} className="min-w-0"><dt className="text-ink-muted">{f.label}</dt><dd className="truncate font-semibold text-ink">{Array.isArray(values[f.id]) ? (values[f.id] as string[]).join(", ") : String(values[f.id])}</dd></div>
        ))}
        {Object.entries(formulas).map(([id, r]) => (
          <div key={id}><dt className="text-ink-muted">{starter.template.fields.find((f) => f.id === id)?.label}</dt><dd className="font-semibold text-ink">{r.ok ? r.value : "—"}</dd></div>
        ))}
      </dl>
    </div>
  );
}

