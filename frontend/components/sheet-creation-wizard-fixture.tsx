"use client";

import { useState } from "react";

import type { FieldValue, SheetTemplate } from "../lib/sheet-template";
import { SYSTEM_STARTERS } from "../lib/system-starters";
import { HomebrewClanEditor } from "./homebrew-clan-editor";
import { SheetCreationWizard } from "./sheet-creation-wizard";

/**
 * Development-only harness: the creation wizard on a Vampire starter (V5 or V3) with in-memory
 * values, so distribution modes, counters and priority points can be checked without Supabase.
 * Served only by app/dev/sheet-wizard, which returns 404 outside `next dev`.
 */
const STARTERS = SYSTEM_STARTERS.filter((item) => item.id === "vampire-v5" || item.id === "vampire-v3");
const TEMPLATE_ID = "00000000-0000-4000-8000-0000000000d1";

export function SheetCreationWizardFixture() {
  const [starterId, setStarterId] = useState<string>("vampire-v5");
  const starter = STARTERS.find((item) => item.id === starterId)!;
  const [schema, setSchema] = useState<SheetTemplate>(starter.template);
  const [values, setValues] = useState<Record<string, FieldValue>>({ ...starter.values });
  const [name, setName] = useState("Mara Quill");
  const stored = { id: TEMPLATE_ID, name: schema.name, version: 1, schema };
  function choose(id: string) {
    const next = STARTERS.find((item) => item.id === id)!;
    setStarterId(id);
    setSchema(next.template);
    setValues({ ...next.values });
  }
  return <main style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px" }}>
    <div role="group" aria-label="Sistema do modelo" style={{ display: "flex", gap: 8, marginTop: 24 }}>
      {STARTERS.map((item) => <button key={item.id} type="button" aria-pressed={starterId === item.id} onClick={() => choose(item.id)}
        style={{ minHeight: 40, padding: "8px 14px", border: "1px solid #425e4b", background: starterId === item.id ? "#425e4b" : "transparent", color: starterId === item.id ? "#fff" : "inherit", cursor: "pointer" }}>{item.label}</button>)}
    </div>
    <details style={{ marginTop: 16 }}><summary>Editor de modelo: clãs homebrew</summary><HomebrewClanEditor template={schema} onChange={setSchema} /></details>
    <SheetCreationWizard key={starterId}
      campaignId="00000000-0000-4000-8000-0000000000c1" templates={[stored]} templateId={TEMPLATE_ID} template={schema}
      values={values} name={name} calculated={{}} busy={false} canCreate={false} canGrantResources={false}
      loading={false} loadError="" feedback="" calculationError=""
      onChooseTemplate={() => undefined} onNameChange={setName}
      onValueChange={(id, value) => setValues((current) => {
        const next = { ...current };
        if (value === undefined) delete next[id]; else next[id] = value;
        return next;
      })}
      onSave={async () => undefined} viewerId="00000000-0000-4000-8000-0000000000a1" portraitPath="dev/fixture.webp" onPortraitChange={() => undefined}
    />
  </main>;
}
