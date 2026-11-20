import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCompendiumImport, parseCsvRows } from "../lib/compendium-import.ts";
import { validateCompendiumProposal, emptyProposalDraft } from "../lib/campaign-compendium.ts";

const valid = { title: "Mérito A", entry_type: "merit", level: 2, tags: ["Mesa", "mesa", "x"], description: "Texto", source_title: "Caderno" };

test("JSON válido é normalizado", () => {
  const { entries, errors } = parseCompendiumImport(JSON.stringify([valid, { ...valid, title: "B", entry_type: "spell", source_kind: "licensed", source_page: 7 }]), "json");
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0].tags, ["mesa", "x"]);
  assert.equal(entries[0].source_kind, "homebrew");
  assert.equal(entries[0].source_page, null);
  assert.equal(entries[1].source_page, 7);
});

test("JSON inválido ou não-lista gera erro do arquivo", () => {
  assert.equal(parseCompendiumImport("{", "json").errors[0].index, -1);
  assert.equal(parseCompendiumImport("{}", "json").errors[0].index, -1);
  assert.equal(parseCompendiumImport("  ", "json").errors[0].index, -1);
});

test("erros apontam o índice do verbete", () => {
  const { entries, errors } = parseCompendiumImport(JSON.stringify([
    valid,
    { ...valid, entry_type: "banana" },
    { ...valid, title: "L", source_kind: "licensed" },
    { ...valid, level: 9 },
    { ...valid, title: "x".repeat(121) },
    "texto",
  ]), "json");
  assert.equal(entries.length, 1);
  assert.deepEqual([...new Set(errors.map((error) => error.index))], [1, 2, 3, 4, 5]);
  assert.match(errors.find((e) => e.index === 2).message, /página/);
});

test("mais de 200 verbetes é rejeitado", () => {
  const many = Array.from({ length: 201 }, (_, i) => ({ ...valid, title: `T${i}` }));
  const result = parseCompendiumImport(JSON.stringify(many), "json");
  assert.equal(result.entries.length, 0);
  assert.equal(result.errors[0].index, -1);
  assert.equal(parseCompendiumImport(JSON.stringify(many.slice(0, 200)), "json").errors.length, 0);
});

test("CSV RFC 4180 com aspas, vírgulas, aspas duplas e quebras de linha", () => {
  const csv = '﻿title,entry_type,level,tags,cost,pool,duration,description,source_title,source_page,source_kind\r\n'
    + '"Ritual, do ""Eco""",ritual,3,sangue;Noite ; sangue,"1 ponto",,,"Linha 1\nLinha 2",Caderno,12,licensed\r\n'
    + 'Item simples,item,,,,,,Descrição,Caderno,,\r\n';
  const { entries, errors } = parseCompendiumImport(csv, "csv");
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].title, 'Ritual, do "Eco"');
  assert.deepEqual(entries[0].tags, ["sangue", "noite"]);
  assert.equal(entries[0].description, "Linha 1\nLinha 2");
  assert.equal(entries[0].source_page, 12);
  assert.equal(entries[0].source_kind, "licensed");
  assert.equal(entries[1].level, 0);
  assert.equal(entries[1].source_kind, "homebrew");
});

test("CSV com cabeçalho incompleto, aspas abertas e linha inválida", () => {
  assert.match(parseCompendiumImport("title,level\nA,1", "csv").errors[0].message, /entry_type/);
  assert.equal(parseCompendiumImport('title,entry_type\n"abc', "csv").errors[0].index, -1);
  const result = parseCompendiumImport("title,entry_type,description,source_title\nA,item,d,s\nB,nope,d,s", "csv");
  assert.equal(result.entries.length, 1);
  assert.equal(result.errors[0].index, 1);
});

test("parseCsvRows ignora linhas em branco finais", () => {
  assert.deepEqual(parseCsvRows("a,b\n1,2\n\n"), [["a", "b"], ["1", "2"]]);
});

test("propose local aceita os novos tipos", () => {
  for (const type of ["merit", "flaw", "ritual", "spell", "power", "item", "rule"]) {
    const { payload } = validateCompendiumProposal("c", { ...emptyProposalDraft(), title: "T", type, description: "d", sourceTitle: "s" });
    assert.equal(payload?.p_entry_type, type);
  }
});
