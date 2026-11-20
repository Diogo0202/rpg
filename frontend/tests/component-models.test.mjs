import assert from "node:assert/strict";
import test from "node:test";

import { filterEvents, journalMarkdown, safePart, sessionDraftOf } from "../components/campaign-journal/model.ts";
import {
  actionTagsFor, buildNumericFields, damageKey, deriveDamageState, maxTrack, outcomeLabel, surgeBonusUsed, traitChoices,
} from "../components/v5-action/model.ts";

const event = (id, extra = {}) => ({
  id, campaign_id: "c1", session_id: null, faction_id: null, title: `Evento ${id}`, description: "", occurred_on: "2026-01-02",
  status: "planned", created_at: "", updated_at: "", ...extra,
});

test("journal filters combine session, status and a case-insensitive search", () => {
  const events = [event("a", { session_id: "s1", title: "Emboscada no Porto" }), event("b", { session_id: "s1", status: "resolved" }), event("c")];
  assert.deepEqual(filterEvents(events, { query: "", session: "s1", faction: "", status: "" }).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(filterEvents(events, { query: "porto", session: "", faction: "", status: "" }).map((item) => item.id), ["a"]);
  assert.deepEqual(filterEvents(events, { query: "", session: "s1", faction: "", status: "resolved" }).map((item) => item.id), ["b"]);
});

test("journal markdown names removed links and escapes markdown marks", () => {
  const markdown = journalMarkdown("c1", {
    sessions: [], factions: [], entityLinks: [],
    events: [event("a", { title: "O *rei*", session_id: "gone", status: "consequence" })],
  });
  assert.match(markdown, /### .* · O \\\*rei\\\*/);
  assert.match(markdown, /Sessão: Sessão removida/);
  assert.match(markdown, /Status: Consequência/);
  assert.match(markdown, /Nenhuma sessão registrada\./);
});

test("journal helpers keep file names safe and drafts editable", () => {
  assert.equal(safePart("Campanha #1 / Teste"), "campanha-1-teste");
  assert.equal(safePart("***"), "campanha");
  const draft = sessionDraftOf({ id: "s1", campaign_id: "c1", sequence: 3, title: "T", summary: "", status: "played", played_on: null, created_at: "", updated_at: "" });
  assert.deepEqual(draft, { id: "s1", sequence: "3", title: "T", summary: "", status: "played", played_on: "" });
});

test("v5 numeric fields skip tracks, hunger and non-integer values", () => {
  const schema = { fields: [
    { id: "forca", label: "Força", kind: "number" },
    { id: "fome", label: "Fome", kind: "number" },
    { id: "briga", label: "Briga", kind: "number" },
    { id: "nome", label: "Nome", kind: "text" },
    { id: "astucia", label: "Astúcia", kind: "number" },
  ] };
  const fields = buildNumericFields(schema, { forca: 3, fome: 2, briga: 1.5, astucia: 2 });
  assert.deepEqual(fields.map((field) => field.id), ["forca", "astucia"]);
  assert.deepEqual(buildNumericFields(null, {}), []);
});

test("v5 trait choices fall back to custom fields when the template has none", () => {
  const custom = [{ id: "poder", label: "Poder", value: 2 }];
  assert.deepEqual(traitChoices(custom), { attributes: custom, skills: custom });
  const known = [{ id: "forca", label: "Força", value: 3 }, { id: "briga", label: "Briga", value: 2 }, ...custom];
  assert.deepEqual(traitChoices(known).attributes.map((field) => field.id), ["forca"]);
  assert.deepEqual(traitChoices(known).skills.map((field) => field.id), ["briga"]);
});

test("v5 tracks follow Vigor + 3 and Composure + Resolve, capped at 30", () => {
  assert.equal(maxTrack({ vigor: 2 }, "health"), 5);
  assert.equal(maxTrack({ autocontrole: 3, resolucao: 2 }, "willpower"), 5);
  assert.equal(maxTrack({ autocontrole: 3 }, "willpower"), 0);
  assert.equal(maxTrack({ vigor: 40 }, "health"), 30);
  assert.equal(damageKey("willpower", "aggravated"), "vontade_agravada");
  assert.deepEqual(deriveDamageState({ vigor: 2, saude_superficial: 1, autocontrole: 1, resolucao: 1, vontade_agravada: 2 }), {
    health_max: 5, health_superficial: 1, health_aggravated: 0, willpower_max: 2, willpower_superficial: 0, willpower_aggravated: 2,
  });
});

test("v5 labels, tags and surge bonus", () => {
  const roll = (outcome) => ({ outcome: { success: false, messy_critical: false, clean_critical: false, bestial_failure: false, ...outcome } });
  assert.equal(outcomeLabel(roll({ success: true, messy_critical: true })), "Crítico sujo");
  assert.equal(outcomeLabel(roll({ bestial_failure: true })), "Falha bestial");
  assert.equal(outcomeLabel(roll({ success: true })), "Sucesso");
  assert.deepEqual(actionTagsFor("forca", ["noite", "fisico"]), ["fisico", "noite"]);
  assert.deepEqual(actionTagsFor("sem-tag", ["noite"]), ["noite"]);
  assert.equal(surgeBonusUsed({ blood_surge: { bonus_dice: 2 } }), 2);
  assert.equal(surgeBonusUsed({}), 0);
  assert.equal(surgeBonusUsed(null), 0);
});

test("sheet template rename follows dependencies and expressions without touching longer ids", async () => {
  const { renameFieldInTemplate } = await import("../components/sheet-builder/template-model.ts");
  const template = { name: "T", version: 1, fields: [
    { id: "vigor", label: "Vigor", kind: "number", required: false, options: [], expression: null },
    { id: "vigor_extra", label: "Extra", kind: "number", required: false, options: [], expression: null },
    { id: "parada", label: "Parada", kind: "formula", required: false, options: [], expression: "vigor + vigor_extra" },
    { id: "cla", label: "Clã", kind: "select", required: false, options: [], expression: null, depends_on: { field_id: "vigor", cases: [] } },
  ] };
  const renamed = renameFieldInTemplate(template, "vigor", "forca");
  assert.deepEqual(renamed.fields.map((field) => field.id), ["forca", "vigor_extra", "parada", "cla"]);
  assert.equal(renamed.fields[2].expression, "forca + vigor_extra");
  assert.equal(renamed.fields[3].depends_on.field_id, "forca");
});

test("sheet template dependency helpers release children, detect cycles and orphans", async () => {
  const { createsDependencyCycle, orphanedDependencyCase, releaseDependents, nextFieldId } = await import("../components/sheet-builder/template-model.ts");
  const select = (id, extra = {}) => ({ id, label: id, kind: "select", required: false, options: [], expression: null, ...extra });
  const template = { name: "T", version: 1, fields: [
    select("a", { options: ["x", "y"] }),
    select("b", { depends_on: { field_id: "a", cases: [{ equals: "x", options: ["1"] }, { equals: "z", options: ["2", "1"] }] } }),
  ] };
  assert.equal(createsDependencyCycle(template, "a", "b"), true);
  assert.equal(createsDependencyCycle(template, "b", "a"), false);
  assert.deepEqual(orphanedDependencyCase(template)?.equals, "z");
  const released = releaseDependents(template.fields, "a");
  assert.deepEqual(released[1].options, ["1", "2"]);
  assert.equal(released[1].depends_on, undefined);
  assert.equal(nextFieldId({ ...template, fields: [...template.fields, select("campo_3")] }), "campo_4");
});

test("sheet values are collected per kind, skip formulas and reject bad rolls", async () => {
  const { collectSheetValues } = await import("../components/sheet-builder/template-model.ts");
  const field = (id, kind, extra = {}) => ({ id, label: id, kind, required: false, options: [], expression: null, ...extra });
  const template = { name: "T", version: 1, fields: [
    field("nome", "text", { character_name: true, required: true }),
    field("vigor", "number", { required: true }),
    field("contatos", "collection"),
    field("protegido", "checkbox"),
    field("parada", "formula", { expression: "vigor" }),
    field("teste", "roll", { expression: "2d6+3" }),
  ] };
  assert.deepEqual(collectSheetValues(template, { vigor: "3", contatos: ["Ana"] }, "Lia"), { nome: "Lia", vigor: 3, contatos: ["Ana"], protegido: false });
  assert.throws(() => collectSheetValues(template, {}, "Lia"), /vigor: informe um número/);
  assert.deepEqual(collectSheetValues(template, {}, "", true), { contatos: [], protegido: false });
  const badRoll = { ...template, fields: [field("teste", "roll", { expression: "d6" })] };
  assert.throws(() => collectSheetValues(badRoll, {}, ""), /use uma rolagem como 2d6\+3/);
});