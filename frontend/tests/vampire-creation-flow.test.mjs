import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { applyGrants, collectionPointRules, collectionPointStatus, grantedNumbers, grantProblems, itemPoints } from "../lib/creation-grants.ts";
import { lockedFieldIds, priorityPatch, priorityRules, tallyPriority } from "../lib/priority-points.ts";
import { characterNameField, creationGroups, identityFields, reconcileDependentValues, validateFields } from "../lib/sheet-creation.ts";
import { SYSTEM_STARTERS } from "../lib/system-starters.ts";

/**
 * Walks the creation wizard step by step the way components/sheet-creation-wizard.tsx does:
 * every edit goes through reconcileDependentValues, applyGrants and priorityPatch, and a step
 * only advances when its local checks pass. The finished sheets are the ones
 * backend/tests/test_vampire_creation_flow.py checks and creates through the API.
 */
const FIXTURE = new URL("../../backend/tests/fixtures/vampire_wizard_sheets.json", import.meta.url);

function wizard(starterId) {
  const starter = SYSTEM_STARTERS.find((item) => item.id === starterId);
  const template = starter.template;
  const labels = new Map(template.fields.map((field) => [field.id, field.label]));
  let values = { ...starter.values };
  const change = (id, value) => {
    const reconciled = reconcileDependentValues(template, { ...values, [id]: value });
    const granted = applyGrants(template, values, reconciled.values);
    const priority = priorityPatch(template, values, { ...reconciled.values, ...granted });
    values = { ...reconciled.values, ...granted, ...priority };
  };
  const steps = [{ step: "identity", fields: identityFields(template) }, ...creationGroups(template)];
  /** Local reasons the step cannot advance, as the wizard's advance() collects them. */
  const problems = (step) => {
    const ids = new Set(step.fields.filter((field) => !lockedFieldIds(template, values).has(field.id)).map((field) => field.id));
    const pools = priorityRules(template).flatMap((rule) => tallyPriority(template, rule, values).pools
      .filter((pool) => pool.pool.groups.some((group) => group.fields.some((id) => ids.has(id))))
      .flatMap((pool) => [...pool.problems, ...(pool.shortfall ? [`${pool.pool.label}: faltam ${pool.shortfall}`] : [])]));
    const fields = Object.values(validateFields(step.fields.filter((field) => ids.has(field.id)), values, template));
    return [...fields, ...grantProblems(template, values, ids, labels), ...pools];
  };
  const fill = (stepName, edits) => {
    const step = steps.find((item) => item.step === stepName);
    assert.ok(step, `step ${stepName} exists`);
    for (const [id, value] of Object.entries(edits)) {
      assert.ok(step.fields.some((field) => field.id === id), `${id} belongs to ${stepName}`);
      change(id, value);
    }
    return problems(step);
  };
  return { template, steps, change, fill, problems, get values() { return values; } };
}

/** What SheetBuilder.collectValues sends: empty texts and selects are left out, formulas are never sent. */
function payload(template, values) {
  const formulas = new Set(template.fields.filter((field) => field.kind === "formula" || field.kind === "roll").map((field) => field.id));
  return Object.fromEntries(Object.entries(values).filter(([id, value]) => value !== "" && value !== undefined && !formulas.has(id)));
}

function stored(sheets) {
  const current = (() => { try { return JSON.parse(readFileSync(FIXTURE, "utf8")); } catch { return {}; } })();
  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(FIXTURE, `${JSON.stringify({ ...current, ...sheets }, null, 1)}\n`);
  return current;
}

test("V3: the wizard reaches a valid sheet through 7/5/3, 13/9/5, 3, 5, 7 and 15 freebies", () => {
  const flow = wizard("vampire-v3");
  assert.equal(characterNameField(flow.template)?.id, "nome");
  assert.deepEqual(flow.fill("identity", { conceito: "Mensageira", natureza: "Rebelde", comportamento: "Galante", seita: "Anarquista", cla: "Brujah" }), []);
  // The clan closes every discipline but its three.
  assert.equal([...lockedFieldIds(flow.template, flow.values)].filter((id) => id.startsWith("disc_")).length, 14);
  assert.deepEqual(flow.fill("attributes", { forca: 4, destreza: 3, vigor: 3, carisma: 3, manipulacao: 3, aparencia: 2, percepcao: 2, inteligencia: 2, raciocinio: 2 }), []);
  const short = flow.fill("skills", { prontidao: 3, esportes: 2, briga: 3, esquiva: 2, empatia: 2, expressao: 1 });
  assert.ok(short.some((problem) => problem.startsWith("Habilidades")), "the skills step waits for 9 and 5 more points");
  assert.deepEqual(flow.fill("skills", { empatia_animais: 2, oficios: 2, conducao: 2, etiqueta: 1, armas_brancas: 2, academicos: 2, investigacao: 2, ocultismo: 1 }), []);
  // Virtues move the bases of Humanity and Willpower; the wizard follows them.
  assert.deepEqual(flow.fill("traits", {
    disc_rapidez: 1, disc_potencia: 1, disc_presenca: 1, ant_aliados: 2, ant_recursos: 2, ant_status: 1, consciencia: 3, autocontrole: 3, coragem: 4, especialidades: ["Força (Agarrar)"],
  }), []);
  assert.deepEqual([flow.values.humanidade, flow.values.forca_vontade], [6, 4]);
  const rule = priorityRules(flow.template)[0];
  assert.equal(tallyPriority(flow.template, rule, flow.values).remaining, 15);
  // Freebies: 2 ability (1 dot), 7 discipline, 4 backgrounds, 1 Humanity, 1 Willpower.
  flow.fill("skills", { briga: 4 });
  flow.fill("traits", { disc_rapidez: 2, ant_contatos: 4 });
  flow.fill("resources", { humanidade: 7, forca_vontade: 5 });
  // Traits at 4 or more need a specialization, and only they may take one.
  const traits = flow.steps.find((step) => step.step === "traits");
  assert.ok(flow.problems(traits).some((problem) => problem.includes("falta especialização em Briga")));
  flow.fill("traits", { especialidades: ["Força (Agarrar)", "Briga (Socos)", "Esquiva (Esquivar balas)"] });
  assert.ok(flow.problems(traits).some((problem) => problem.includes("pede ao menos 4 pontos em Esquiva")));
  flow.fill("traits", { especialidades: ["Força (Agarrar)", "Briga (Socos)"] });
  // A Flaw adds a freebie that a Merit spends; both come from the catalogs.
  flow.fill("traits", { defeitos: ["Pesadelos •"] });
  assert.equal(tallyPriority(flow.template, rule, flow.values).remaining, 1, "a 1-point Flaw adds one freebie");
  flow.fill("traits", { meritos: ["Sentido Aguçado: audição (1)", "Rubor da Saúde •"] });
  assert.ok(flow.problems(traits).some((problem) => problem.includes("Rubor da Saúde aceita 2 pontos")));
  flow.fill("traits", { meritos: ["Sentido Aguçado: audição (1)"] });
  const tally = tallyPriority(flow.template, rule, flow.values);
  assert.deepEqual([tally.remaining, tally.complete], [0, true]);
  for (const step of flow.steps) assert.deepEqual(flow.problems(step), [], `step ${step.step} is clear`);
  // Raising a virtue after the freebies keeps the bought point over the new base, which overspends.
  const before = flow.values;
  flow.change("consciencia", 4);
  assert.equal(flow.values.humanidade, 8);
  assert.equal(tallyPriority(flow.template, rule, flow.values).complete, false);
  flow.change("consciencia", 3);
  assert.deepEqual(flow.values, before);
  const sheet = { name: "Mara", values: payload(flow.template, flow.values) };
  assert.deepEqual(stored({ v3: sheet }).v3, sheet, "UPDATE_FIXTURES=1 regenerates backend/tests/fixtures/vampire_wizard_sheets.json");
});

test("V3: the Path opens its virtues and moves the starting rating; no predator type; Malkavians get Dementação", () => {
  const flow = wizard("vampire-v3");
  assert.equal(flow.template.fields.some((field) => field.id === "predador"), false);
  assert.equal(flow.values.trilha, "Humanidade");
  flow.fill("traits", { consciencia: 3, autocontrole: 2, coragem: 2 });
  assert.equal(flow.values.humanidade, 5);
  // Path of Caine uses Convicção and Instintos: Humanity's pair falls back to 1 and the rating follows.
  flow.fill("identity", { trilha: "Trilha de Caim" });
  assert.deepEqual([flow.values.consciencia, flow.values.autocontrole, flow.values.humanidade], [1, 1, 2]);
  flow.fill("traits", { conviccao: 3, instintos: 4 });
  assert.equal(flow.values.humanidade, 7);
  assert.ok(lockedFieldIds(flow.template, flow.values).has("consciencia"));
  flow.fill("identity", { cla: "Malkaviano" });
  const open = ["disc_auspicios", "disc_dementacao", "disc_ofuscacao"];
  assert.deepEqual(open.filter((id) => lockedFieldIds(flow.template, flow.values).has(id)), []);
  assert.ok(lockedFieldIds(flow.template, flow.values).has("disc_dominacao"));
  assert.deepEqual(flow.template.fields.find((field) => field.id === "fraqueza").depends_on.cases.find((item) => item.equals === "Malkaviano").options,
    ["Perturbação permanente"]);
  // Blood follows the generation: 13th 10/1 ... 8th 15/3.
  const expressions = Object.fromEntries(flow.template.fields.filter((field) => field.kind === "formula").map((field) => [field.id, field.expression]));
  const evaluate = (expression, ant_geracao) => Function("ant_geracao", `return ${expression.replaceAll("//", "/")}`)(ant_geracao);
  const floor = (expression, value) => Math.floor(evaluate(expression.replace("(ant_geracao // 4)", "Math.floor(ant_geracao / 4)"), value));
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((value) => [evaluate(expressions.sangue_max, value), floor(expressions.sangue_por_turno, value)]),
    [[10, 1], [11, 1], [12, 1], [13, 1], [14, 2], [15, 3]]);
});

test("V3 play rules mirror the API: 1s cancel, botch, specialty, Willpower, health and blood", async () => {
  const { isV3Sheet, v3Derived, v3HealthPenalty, v3Outcome } = await import("../lib/v3-rules.ts");
  assert.deepEqual([v3Outcome([1, 6, 7], 6).successes, v3Outcome([1, 2], 6).botch, v3Outcome([1, 6], 6).botch], [1, true, false]);
  assert.equal(v3Outcome([10, 3], 6, true).successes, 2);
  assert.deepEqual([v3Outcome([1, 1], 6, false, true).successes, v3Outcome([1, 1], 6, false, true).botch], [1, false]);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map(v3HealthPenalty), [0, 0, -1, -1, -2, -2, -5, null]);
  const starter = SYSTEM_STARTERS.find((item) => item.id === "vampire-v3");
  assert.equal(isV3Sheet(starter.values), true);
  assert.equal(isV3Sheet(SYSTEM_STARTERS.find((item) => item.id === "vampire-v5").values), false);
  const derived = v3Derived({ ...starter.values, ant_geracao: 5, dano_letal: 2, trilha: "Trilha da Harmonia" });
  assert.deepEqual([derived.bloodMax, derived.perTurn, derived.level, derived.penalty, derived.conscience, derived.selfControl],
    [15, 3, "Machucado", -1, "consciencia", "instintos"]);
});

test("V5: the predator chain applies and undoes its grants and Blood Potency follows generation", () => {
  const flow = wizard("vampire-v5");
  flow.fill("identity", { conceito: "Mensageira", cla: "Brujah", predador: "Sanguessuga" });
  assert.deepEqual([flow.values.humanidade, flow.values.potencia_sangue, flow.values.disc_potencia], [6, 2, 1]);
  const identity = flow.steps.find((step) => step.step === "identity");
  assert.ok(flow.problems(identity).some((problem) => problem.includes("escolha disciplina bônus")));
  flow.fill("identity", { predador_disciplina: "Rapidez", predador_especialidade: "Briga (Membros)", perdicao: "Fúria Latente" });
  assert.deepEqual(flow.problems(identity), []);
  // F2: a Convicção pede sua Pedra de Toque, e os Princípios vêm da mesa.
  const story = flow.steps.find((step) => step.step === "story");
  assert.ok(flow.fill("story", { conviccao_1: "Nunca abandonar os meus" }).length > 0, "a lone conviction is refused");
  assert.deepEqual(flow.fill("story", { pedra_toque_1: "Irmã caçula", principios_cronica: ["Não matar inocentes"] }), []);
  assert.deepEqual(flow.problems(story), []);
  assert.deepEqual([flow.values.disc_rapidez, flow.values.especialidades], [2, ["Briga (Membros)"]]);
  // Generation moves the base: the 11th generation starts one dot higher, outside the bands is refused.
  flow.fill("resources", { geracao: 11 });
  assert.equal(flow.values.potencia_sangue, 3);
  const resources = flow.steps.find((step) => step.step === "resources");
  flow.change("geracao", 9);
  assert.ok(flow.problems(resources).some((problem) => problem.includes("fora das faixas")));
  flow.change("geracao", 13);
  assert.equal(flow.values.potencia_sangue, 2);
  // Resources counts toward Advantages, so the resources step shows that budget too.
  assert.deepEqual(flow.problems(resources), ["Vantagens: 0 de 7 pontos."]);
  // Advantages: 7 own points (Resources included); the predator's flaws are extra.
  const advantages = collectionPointRules(flow.template).find((rule) => rule.collection === "vantagens");
  flow.fill("traits", { vantagens: ["Aliados •••", "Refúgio (2)", "Contatos 1"] });
  assert.equal(collectionPointStatus(flow.template, advantages, flow.values).spent, 6);
  flow.fill("resources", { recursos: 1 });
  assert.equal(collectionPointStatus(flow.template, advantages, flow.values).complete, true);
  const traits = flow.steps.find((step) => step.step === "traits");
  assert.ok(flow.problems(traits).some((problem) => problem.startsWith("Defeitos: 0 de 2")));
  // Flaws come from the template's catalog at one of their costs.
  flow.fill("traits", { defeitos: [...flow.values.defeitos, "Vício ••"] });
  assert.ok(flow.problems(traits).some((problem) => problem.includes("Vício aceita 1 ponto")));
  flow.fill("traits", { defeitos: [...flow.values.defeitos.filter((item) => item !== "Vício ••"), "Maldição Inventada ••"] });
  assert.ok(flow.problems(traits).some((problem) => problem.includes("fora do catálogo")));
  flow.fill("traits", { defeitos: [...flow.values.defeitos.filter((item) => item !== "Maldição Inventada ••"), "Vício Irremediável ••"] });
  assert.equal(flow.problems(traits).some((problem) => problem.startsWith("Defeitos")), false);
  flow.fill("attributes", { forca: 4, destreza: 3, vigor: 3, carisma: 3, manipulacao: 2, autocontrole: 2, inteligencia: 2, raciocinio: 2, resolucao: 1 });
  flow.fill("skills", { atletismo: 4, briga: 3, conducao: 3, furtividade: 3, ladroagem: 2, oficios: 2, sobrevivencia: 2, armas_brancas: 1, armas_de_fogo: 1, etiqueta: 1 });
  // Free specialties: one in Ofícios (it has dots) plus one more; the predator's stays extra.
  assert.ok(flow.problems(traits).some((problem) => problem.includes("falta especialização em Ofícios")));
  flow.fill("traits", { especialidades: [...flow.values.especialidades, "Ofícios (Marcenaria)", "Medicina (Primeiros socorros)"] });
  assert.ok(flow.problems(traits).some((problem) => problem.includes("pede ao menos 1 ponto em Medicina")));
  flow.fill("traits", { especialidades: [...flow.values.especialidades.filter((item) => !item.startsWith("Medicina")), "Atletismo (Corrida)"] });
  flow.fill("traits", { disciplinas: ["Potência: Corpo Letal", "Presença: Fascínio", "Rapidez: Graça Felina", "Rapidez: Ligeireza"] });
  for (const step of flow.steps) assert.deepEqual(flow.problems(step), [], `step ${step.step} is clear`);
  const finished = flow.values;
  // Swapping the predator undoes Humanity, Potency, the discipline dot, the specialty and the granted flaws.
  flow.change("predador", "Consensualista");
  assert.deepEqual([flow.values.humanidade, flow.values.potencia_sangue, flow.values.disc_rapidez], [8, 1, 1]);
  assert.equal(flow.values.especialidades.includes("Briga (Membros)"), false);
  assert.equal(flow.values.defeitos.includes("Exclusão de Presa: mortais ••"), false);
  assert.ok(flow.values.defeitos.includes("Exclusão de Presa: quem não consente •"));
  assert.ok(flow.values.defeitos.includes("Vício Irremediável ••"), "the player's own flaw stays");
  assert.equal(grantedNumbers(flow.template, flow.values).enforced.get("potencia_sangue"), 1);
  const sheet = { name: "Mara", values: payload(flow.template, finished) };
  assert.deepEqual(stored({ v5: sheet }).v5, sheet, "UPDATE_FIXTURES=1 regenerates backend/tests/fixtures/vampire_wizard_sheets.json");
});

test("V5: thin-blooded need the 14th-16th generation and refuse the Blood Potency predator", () => {
  const flow = wizard("vampire-v5");
  const identity = flow.steps.find((step) => step.step === "identity");
  const resources = flow.steps.find((step) => step.step === "resources");
  flow.fill("identity", { cla: "Sangue-Ralo" });
  assert.ok(flow.problems(identity).some((problem) => problem.includes("Geração deve ficar entre 14 e 16 para Sangue-Ralo")));
  flow.fill("resources", { geracao: 15 });
  assert.equal(flow.problems(resources).some((problem) => problem.startsWith("Clã e geração")), false);
  flow.fill("identity", { predador: "Sanguessuga" });
  assert.ok(flow.problems(identity).some((problem) => problem.includes("Tipo de predador Sanguessuga não combina com Sangue-Ralo")));
  flow.fill("identity", { predador: "Criador", cla: "Caitiff" });
  assert.ok(flow.problems(resources).some((problem) => problem.includes("entre 10 e 13 para Caitiff")), "Caitiff are not thin-blooded");
  flow.change("geracao", 12);
  assert.equal(flow.problems(resources).some((problem) => problem.startsWith("Clã e geração")), false);
});

test("item names drop points and detail", async () => {
  const { itemName } = await import("../lib/creation-checks.ts");
  assert.deepEqual(["Aliados: polícia ••", "Aliados (polícia) (2)", "Contatos 1", " Refúgio  (2)", "Segredo Sombrio: Diablerista ••"].map(itemName),
    ["Aliados", "Aliados", "Contatos", "Refúgio", "Segredo Sombrio"]);
});

test("item points read dots or a trailing number", () => {
  assert.deepEqual(["Aliados •••", "Refúgio (2)", "Contatos 1", "Mawla", "Rebanho 2 ou 3"].map(itemPoints), [3, 2, 1, 0, 3]);
});
