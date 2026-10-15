import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_VAULT_METADATA, filterAndSortVault, parseTagsInput, validateNamedVaultFilters, validateVaultFilter, validateVaultMetadata } from "../lib/vault-metadata.ts";

test("metadata accepts optional level and validates tag limits", () => {
  assert.deepEqual(validateVaultMetadata(EMPTY_VAULT_METADATA), { level: null, tags: [], concept: "" });
  assert.equal(validateVaultMetadata({ level: 100, tags: ["  Noite ", "noite"], concept: " Vazio " }).tags.length, 1);
  assert.throws(() => validateVaultMetadata({ level: 101, tags: [], concept: "" }));
  assert.throws(() => validateVaultMetadata({ level: null, tags: Array(21).fill("tag"), concept: "" }));
  assert.throws(() => validateVaultMetadata({ level: null, tags: ["x".repeat(33)], concept: "" }));
});

test("tag input splits commas and lines and enforces caps", () => {
  assert.deepEqual(parseTagsInput("noite, aliados\nruinas"), ["noite", "aliados", "ruinas"]);
  assert.throws(() => parseTagsInput(Array(21).fill("x").join(",")));
});

test("search covers name, system, concept and tags, then applies level and tag filters", () => {
  const rows = [
    { name: "Mara", system: "Vampiro", concept: "investigadora", tags: ["noite"], level: 5, createdAt: "2024-01-01", updatedAt: "2024-02-01" },
    { name: "Luz", system: "Brumas", concept: "mensageira", tags: ["ruinas"], level: 2, createdAt: "2024-02-01", updatedAt: "2024-03-01" },
  ];
  for (const query of ["mara", "vampiro", "investigadora", "noite"]) assert.equal(filterAndSortVault(rows, { query, level: "", tag: "", sort: "name" }).length, 1);
  assert.deepEqual(filterAndSortVault(rows, { query: "", level: "5", tag: "NOITE", sort: "name" }).map((row) => row.name), ["Mara"]);
});

test("all four order modes and saved filter validation work", () => {
  const rows = [
    { name: "Zed", system: "A", createdAt: "2024-02-01", updatedAt: "2024-01-01" },
    { name: "Ana", system: "Z", createdAt: "2024-01-01", updatedAt: "2024-02-01" },
  ];
  const sorted = (sort) => filterAndSortVault(rows, { query: "", level: "", tag: "", sort }).map((row) => row.name);
  assert.deepEqual(sorted("created"), ["Zed", "Ana"]);
  assert.deepEqual(sorted("updated"), ["Ana", "Zed"]);
  assert.deepEqual(sorted("name"), ["Ana", "Zed"]);
  assert.deepEqual(sorted("system"), ["Zed", "Ana"]);
  assert.equal(validateNamedVaultFilters([{ id: "1", name: "Busca", query: "x", level: "", tag: "", sort: "system" }]).length, 1);
  assert.throws(() => validateNamedVaultFilters(Array(21).fill({ id: "x", name: "x", query: "", level: "", tag: "", sort: "name" })));
  assert.throws(() => validateVaultFilter({ query: "", level: "101", tag: "", sort: "name" }));
});
