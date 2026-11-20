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
