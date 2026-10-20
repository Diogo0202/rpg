import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { SYSTEM_STARTERS, type SystemStarter } from "@/lib/system-starters.ts";
import type { FieldValue } from "@/lib/sheet-template.ts";
import { creationGroups, creationStepLabel, identityFields, reconcileDependentValues, validateFields, characterNameField } from "@/lib/sheet-creation.ts";
import { FieldInput } from "@/components/nexus/FieldInput";
import { Btn, LocalGate, PageHeader, Panel, Tag } from "@/components/nexus/ui";
import { computeFormulas, focusSheetError, IDENTITY_LABELS, prepareSheetValues, wizardTransition } from "@/lib/nexus/sheets";
import { useNexus } from "@/lib/nexus/store";
import type { JsonValue } from "@/lib/mobile-sync/index.ts";

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
  const [starter, setStarter] = useState<SystemStarter | null>(null);
  return (
    <>
      <PageHeader title="Nova ficha" subtitle="Assistente guiado. Modelos-base parciais; regras completas dependem das fontes oficiais." />
      <LocalGate>
        {!starter ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {SYSTEM_STARTERS.map((s) => (
              <Btn key={s.id} variant="outline" onClick={() => setStarter(s)} className="parchment flex h-auto flex-col items-start p-4 text-left hover:ring-2 hover:ring-ring">
                <p className="font-display text-xl font-semibold text-ink">{s.label}</p>
                <p className="mt-1 text-sm text-ink-muted">{s.template.name} · {s.template.fields.length} campos</p>
              </Btn>
            ))}
          </div>
        ) : <Wizard starter={starter} onCancel={() => setStarter(null)} />}
      </LocalGate>
    </>
  );
}

function Wizard({ starter, onCancel }: { starter: SystemStarter; onCancel: () => void }) {
  const template = starter.template;
  const { create } = useNexus();
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, FieldValue>>(() => ({ ...starter.values }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const nameField = characterNameField(template);
  const idFields = identityFields(template);
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

  const onChange = (id: string, v: FieldValue | undefined) => {
    const next = { ...values };
    if (v === undefined) delete next[id]; else next[id] = v;
    const r = reconcileDependentValues(template, next);
    setRemoved(r.removedIds.filter((rid) => values[rid] !== undefined && r.values[rid] === undefined));
    setValues(r.values);
    setErrors((e) => { const n = { ...e }; delete n[id]; return n; });
  };

  const goTo = (target: number) => {
    const result = wizardTransition(steps, step, target, values, template);
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
    setSaving(true);
    try {
      const stored = { ...prepared.values, ativo_na_sessao: true };
      const name = prepared.name;
      const id = await create("character_sheets", {
        name, system_key: starter.id, template_name: template.name, template_version: template.version,
        values: stored as Record<string, JsonValue>, effects: [],
      });
      toast.success("Ficha salva neste aparelho e selecionada na sessão.");
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
        {removed.length > 0 && (
          <p className="parchment-inset mb-3 p-3 text-sm text-ink" role="status">Algumas escolhas dependentes foram limpas por incompatibilidade: {removed.join(", ")}. Revise.</p>
        )}
        {current.key === "review" ? <Review starter={starter} values={values} formulas={formulas} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            {current.fields.map((f) => (
              <FieldInput key={f.id} template={template} field={f} values={values} error={errors[f.id]} formula={formulas[f.id]} onChange={onChange} idPrefix="nova" />
            ))}
          </div>
        )}
      </Panel>
      <div className="flex flex-wrap justify-between gap-2">
        <Btn variant="forest" onClick={step === 0 ? onCancel : () => setStep(step - 1)}>{step === 0 ? "Trocar sistema" : "Voltar"}</Btn>
        {current.key === "review"
          ? <Btn onClick={() => void save()} disabled={saving}>{saving ? "Salvando…" : "Criar personagem"}</Btn>
           : <Btn onClick={() => goTo(step + 1)}>Avançar</Btn>}
      </div>
    </div>
  );
}

function Review({ starter, values, formulas }: { starter: SystemStarter; values: Record<string, FieldValue>; formulas: ReturnType<typeof computeFormulas> }) {
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

