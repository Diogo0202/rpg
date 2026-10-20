import test from "node:test";
import assert from "node:assert/strict";
import { aiStatusLabel, buildPublicationFields, contextBinding } from "../lib/ai-assistance.ts";

test("selected context requires a fresh preview hash", () => {
  assert.throws(() => contextBinding([{ kind: "entity", id: "npc" }]), /prévia/);
  assert.deepEqual(contextBinding([], undefined), { context_refs: [] });
  assert.deepEqual(contextBinding([{ kind: "entity", id: "npc" }], "hash"), { context_refs: [{ kind: "entity", id: "npc" }], context_hash: "hash" });
});

test("publication never copies unselected private fields", () => {
  const fields = buildPublicationFields("npc", ["name", "description"], { name: " Public name ", description: "Face", secret: "Betrayal", motivation: "Private motive" }, true);
  assert.deepEqual(fields, { name: "Public name", description: "Face" });
  assert.throws(() => buildPublicationFields("npc", ["name", "secret"], { name: "NPC", secret: "Betrayal" }, true), /públicos/);
  assert.throws(() => buildPublicationFields("session", ["scenes"], { scenes: "Secrets" }, false), /públicos/);
});

test("new records require explicit public names, existing ones support partial publication", () => {
  assert.throws(() => buildPublicationFields("npc", ["description"], { description: "Face" }, true), /nome público/);
  assert.deepEqual(buildPublicationFields("npc", ["description"], { description: "Face" }, false), { description: "Face" });
  assert.deepEqual(buildPublicationFields("session", ["title"], { title: "Next session", summary: "Secret" }, true), { title: "Next session" });
});

test("relationships must have the reviewed object contract", () => {
  const relationships = [{ target_id: "ally", relation_type: "ally", notes: "Public tie" }];
  assert.deepEqual(buildPublicationFields("npc", ["relationships"], { relationships: JSON.stringify(relationships) }, false), { relationships });
  for (const invalid of ['["ally"]', '[{"target_id":"ally","relation_type":"ally","notes":"","secret":"hidden"}]', '{}']) {
    assert.throws(() => buildPublicationFields("npc", ["relationships"], { relationships: invalid }, false));
  }
});

test("approval status is distinct from generation", () => {
  assert.equal(aiStatusLabel("pending"), "Aguardando mestre");
  assert.equal(aiStatusLabel("approved"), "Aprovado");
});
