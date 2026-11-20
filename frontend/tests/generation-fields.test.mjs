import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemFields, coerceFieldValue, fieldsToRows, SYSTEM_FIELD_LIMITS } from "../lib/generation-fields.ts";

test("buildSystemFields converts rows and coerces scalars", () => {
  const result = buildSystemFields([
    { key: " Nível ", value: "3" }, { key: "Dano", value: "1d6" }, { key: "boss", value: "true" }, { key: "", value: "" },
  ]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.fields, { Nível: 3, Dano: "1d6", boss: true });
});

test("buildSystemFields reports incomplete, invalid and repeated rows", () => {
  assert.match(buildSystemFields([{ key: "", value: "x" }]).errors[0], /nome do campo/);
  assert.match(buildSystemFields([{ key: "força", value: "" }]).errors[0], /valor/);
  assert.match(buildSystemFields([{ key: "a{b}", value: "1" }]).errors[0], /letras/);
  assert.match(buildSystemFields([{ key: "__proto__", value: "1" }]).errors[0], /letras/);
  assert.match(buildSystemFields([{ key: "a", value: "1" }, { key: "a", value: "2" }]).errors[0], /repetido/);
  assert.deepEqual(buildSystemFields([{ key: "a", value: "1" }, { key: "a", value: "2" }]).fields, {});
});

test("buildSystemFields enforces backend limits", () => {
  const tooMany = Array.from({ length: SYSTEM_FIELD_LIMITS.maxKeys + 1 }, (_, i) => ({ key: `k${i}`, value: "v" }));
  assert.match(buildSystemFields(tooMany).errors.join(" "), /no máximo 40/);
  assert.equal(buildSystemFields(tooMany.slice(0, 40)).errors.length, 0);
  assert.match(buildSystemFields([{ key: "k".repeat(61), value: "v" }]).errors[0], /passou de 60/);
  assert.match(buildSystemFields([{ key: "k", value: "v".repeat(501) }]).errors[0], /passou de 500/);
  const big = Array.from({ length: 20 }, (_, i) => ({ key: `campo${i}`, value: "x".repeat(500) }));
  assert.match(buildSystemFields(big).errors.join(" "), /8 KB/);
});

test("coerceFieldValue and fieldsToRows", () => {
  assert.equal(coerceFieldValue("-2.5"), -2.5);
  assert.equal(coerceFieldValue("007x"), "007x");
  assert.deepEqual(fieldsToRows({ a: 1, b: "x", c: { d: 1 } }), [
    { key: "a", value: "1" }, { key: "b", value: "x" }, { key: "c", value: "{\"d\":1}" },
  ]);
  assert.deepEqual(fieldsToRows(null), []);
});
