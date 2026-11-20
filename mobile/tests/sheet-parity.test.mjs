import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { SYSTEM_STARTERS } from "../../shared/rules/system-starters.ts";
import { creationRuleViolations } from "../../shared/rules/creation-grants.ts";
import { freebieItemPoints, lockedFieldIds, priorityPatch, priorityRules, tallyPriority } from "../../shared/rules/priority-points.ts";
import { masterGrantedFieldIds, validateFields } from "../../shared/rules/sheet-creation.ts";
import { hunterCreationProblems, hunterV5CreationProblems } from "../../shared/rules/hunter-traits.ts";
import { SyncEngine } from "../src/lib/mobile-sync/engine.ts";
import { MemorySyncStore } from "../src/lib/mobile-sync/store.ts";
import { applyChanges } from "../src/lib/mobile-sync/merge.ts";

const read = async (name) => JSON.parse(await readFile(new URL(`../../backend/tests/fixtures/${name}.json`, import.meta.url), "utf8"));
const starter = (id) => SYSTEM_STARTERS.find((item) => item.id === id);
const plain = (value) => JSON.parse(JSON.stringify(value));
const violated = (template, values) => creationRuleViolations(template, values).map((rule) => rule.id).sort();

test("todos os modelos-base têm XP", () => {
  for (const item of SYSTEM_STARTERS) {
    assert.equal(item.template.experience_field, "experiencia", item.id);
    assert.ok(item.template.fields.some((field) => field.id === "experiencia"), item.id);
  }
});

test("V5: campos sanguíneos, Convicções, Perdição e Ressonância iguais ao modelo do servidor", async () => {
  const web = (await read("v5_starter")).template;
  const mine = starter("vampire-v5").template;
  const ids = ["perdicao", "severidade_perdicao", "principios_cronica", "ressonancia_atual", "intensidade_ressonancia", "discrasia",
    "conviccao_1", "pedra_toque_1", "compulsao_atual", "segredos", "torpor"];
  for (const id of ids) {
    const field = mine.fields.find((item) => item.id === id);
    assert.ok(field, `campo ${id} ausente`);
    assert.deepEqual(plain(field), web.fields.find((item) => item.id === id), `campo ${id} difere do servidor`);
  }
  assert.equal(mine.fields.find((item) => item.id === "segredos").private, true);
  assert.deepEqual(plain(mine.meta_currencies), web.meta_currencies);
  // Convicção and Pedra de Toque are filled together.
  const conviction = mine.fields.find((item) => item.id === "conviccao_1");
  assert.equal(conviction.paired_with, "pedra_toque_1");
  const errors = validateFields(mine.fields, { ...starter("vampire-v5").values, nome: "Lia", conviccao_1: "Nunca trair a família" }, mine);
  assert.ok(errors.pedra_toque_1 || errors.conviccao_1, "a convicção sem pedra de toque precisa de erro por campo");
  // Bane follows the clan.
  const bane = mine.fields.find((item) => item.id === "perdicao");
  assert.equal(bane.depends_on.field_id, "cla");
});

test("V3: Senhor, Refúgio, Fraqueza, Trilha, Qualidades, Defeitos e Especializações iguais ao servidor", async () => {
  const web = (await read("v3_starter")).template;
  const mine = starter("vampire-v3").template;
  assert.deepEqual(plain(mine), web);
  for (const id of ["senhor", "refugio", "fraqueza", "trilha", "meritos", "defeitos", "especialidades", "dano_agravado", "em_frenesi"]) {
    assert.ok(mine.fields.some((item) => item.id === id), `campo ${id} ausente`);
  }
  assert.equal(mine.fields.some((item) => item.id === "predador"), false, "V3 não tem tipo de predador");
  assert.deepEqual(mine.fields.find((item) => item.id === "fraqueza").depends_on.field_id, "cla");
});

test("V3: Defeitos somam bônus até o teto e Qualidades gastam", async () => {
  const sheets = await read("vampire_wizard_sheets");
  const template = starter("vampire-v3").template;
  const rule = priorityRules(template)[0];
  const base = sheets.v3.values;
  assert.equal(tallyPriority(template, rule, base).complete, true);
  const items = freebieItemPoints(rule, { ...base, meritos: ["Sono Leve •"], defeitos: ["Pesadelos •"] });
  assert.deepEqual(items, { spent: 1, earned: 1 });
  const capped = freebieItemPoints(rule, { ...base, defeitos: Array.from({ length: 10 }, (_, index) => `Defeito ${index} •`) });
  assert.equal(capped.earned, rule.freebie_items.earn.max);
});

test("V3: trocar a Trilha bloqueia as virtudes de outra Trilha e reajusta os valores", () => {
  const template = starter("vampire-v3").template;
  const values = { ...starter("vampire-v3").values };
  const path = template.fields.find((item) => item.id === "trilha");
  const other = path.options.find((option) => option !== values.trilha);
  if (!other) return;
  const before = lockedFieldIds(template, values);
  const after = lockedFieldIds(template, { ...values, trilha: other });
  assert.notDeepEqual([...before].sort(), [...after].sort(), "a Trilha muda as virtudes disponíveis");
  const patch = priorityPatch(template, values, { ...values, trilha: other });
  for (const id of after) if (id in patch) assert.equal(typeof patch[id], "number");
});

test("Caçador v4 preserva o catálogo aprovado enquanto v5 exige o catálogo atual", async () => {
  const legacy = await read("hunter_starter");
  assert.equal(legacy.version, 4);
  assert.ok(legacy.fields.find((field) => field.id === "distincoes").item_options.includes("Arsenal: Especializado"));
  const values = { credo: "Marcial", impulso: "Juramento", conviccao_1: "Proteger a família", pedra_toque_1: "Clara",
    triunfos: ["Arsenal", "Biblioteca"], distincoes: ["Arsenal: Especializado"] };
  assert.deepEqual(hunterCreationProblems(values), []);
  assert.ok(hunterV5CreationProblems({ ...values, pilares: ["Clara"] }).some((problem) => problem.includes("fora do catálogo")));
});

test("Caçador v5: Triunfos e Distinções em lista fechada, equipamento e sem desespero, igual ao servidor", async () => {
  const web = await read("hunter_starter_v5");
  const mine = starter("hunter");
  assert.deepEqual(plain(mine.template), web);
  assert.equal(mine.template.version, 5);
  assert.equal(mine.template.fields.some((item) => item.id === "desespero"), false);
  for (const id of ["triunfos", "distincoes"]) assert.ok(mine.template.fields.find((item) => item.id === id).item_options.length > 0, id);
  assert.ok(mine.template.fields.some((item) => item.id === "equipamento"));
  assert.ok(violated(mine.template, mine.values).length > 0, "a ficha vazia não passa nas regras de criação");
});

test("XP e moedas do tipo pool começam em zero e só o Mestre concede", () => {
  const ids = masterGrantedFieldIds(starter("vampire-v3").template);
  assert.ok(ids.has("experiencia"));
  assert.ok(ids.has("pontos_sangue"));
});

// Minimal FastAPI stand-in: creates and nested updates, as mobile-sync.test.mjs exercises in depth.
class SheetServer {
  records = new Map(); events = []; revision = 0;
  async push(campaignId, body) {
    const results = body.mutations.map((mutation) => {
      const key = `${mutation.entity_type}/${mutation.entity_id}`;
      const current = this.records.get(key);
      const record = mutation.action === "create"
        ? { entity_type: mutation.entity_type, id: mutation.entity_id, version: 1, data: applyChanges({}, mutation.changes) }
        : { ...current, version: current.version + 1, data: applyChanges(current.data, mutation.changes) };
      this.records.set(key, record);
      this.events.push({ revision: ++this.revision, entity_type: record.entity_type, entity_id: record.id, version: record.version, action: mutation.action, record: structuredClone(record) });
      return { operation_id: mutation.operation_id, status: "applied", record: structuredClone(record) };
    });
    return { protocol_version: 1, campaign_id: campaignId, cursor: String(this.revision), results };
  }
  async changes(campaignId, cursor = "") {
    const offset = Number(cursor || 0);
    const changes = this.events.filter((event) => event.revision > offset);
    return { protocol_version: 1, campaign_id: campaignId, cursor: String(changes.at(-1)?.revision ?? offset), has_more: false, changes };
  }
  async snapshot(campaignId) { return { protocol_version: 1, campaign_id: campaignId, cursor: String(this.revision), records: [], has_more: false, next_after_id: null }; }
}

test("os campos novos de V5, V3 e Caçador atravessam a fila offline sem perda", async () => {
  let n = 0;
  const server = new SheetServer();
  const engine = new SyncEngine({
    accountId: "acct-a", campaignId: "camp-a", deviceId: "00000000-0000-4000-8000-000000000aaa",
    entityFields: { character_sheets: ["template_id", "name", "values"] }, now: () => 1000,
    randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, retryBaseMs: 0, retryMaxMs: 0,
  }, new MemorySyncStore(), server);
  const sheets = await read("vampire_wizard_sheets");
  const builds = {
    v5: { ...sheets.v5.values, conviccao_1: "Proteger os meus", pedra_toque_1: "Irmã Ana", perdicao: starter("vampire-v5").template.fields.find((f) => f.id === "perdicao").depends_on.cases[0].options[0],
      ressonancia_atual: "Sanguínea", compulsao_atual: "Fome", segredos: "Diablerista", torpor: false, experiencia: 0 },
    v3: { ...sheets.v3.values, senhor: "Marcus", refugio: "Cripta", meritos: ["Sono Leve •"], defeitos: ["Pesadelos •"], especialidades: ["Briga (Socos)"], segredos: "Deve um favor" },
    hunter: { ...starter("hunter").values, triunfos: [starter("hunter").template.fields.find((f) => f.id === "triunfos").item_options[0]], distincoes: [], equipamento: ["Lanterna UV"] },
  };
  const ids = {};
  for (const [key, values] of Object.entries(builds)) {
    ids[key] = `00000000-0000-4000-8000-0000000001${String(Object.keys(ids).length).padStart(2, "0")}`;
    await engine.enqueue({ entityType: "character_sheets", entityId: ids[key], action: "create", changes: [
      { path: ["template_id"], before: { exists: false }, after: { exists: true, value: "00000000-0000-4000-8000-000000000999" } },
      { path: ["name"], before: { exists: false }, after: { exists: true, value: key } },
      { path: ["values"], before: { exists: false }, after: { exists: true, value: values } },
    ] });
  }
  // An offline edit on a nested private field rides the same queue.
  await engine.enqueue({ entityType: "character_sheets", entityId: ids.v3, action: "update", changes: [
    { path: ["values", "segredos"], before: { exists: true, value: "Deve um favor" }, after: { exists: true, value: "Deve dois favores" } },
  ] });
  await engine.sync();
  for (const [key, values] of Object.entries(builds)) {
    const stored = server.records.get(`character_sheets/${ids[key]}`).data.values;
    assert.deepEqual(plain(stored), key === "v3" ? { ...values, segredos: "Deve dois favores" } : values, key);
  }
});
