import test from "node:test";
import assert from "node:assert/strict";
import { deleteCampaignSheet, diffSheetVersions, listSheetVersions, restoreSheetVersion } from "../lib/sheet-history.ts";

test("diff lists only changed fields with template labels", () => {
  const changes = diffSheetVersions(
    { name: "Lia", values: { vigor: 3, contatos: ["Ana"], protegido: true, nome: "Lia" } },
    { name: "Lia Antiga", values: { vigor: 1, contatos: ["Ana"], protegido: false, nome: "Lia" } },
    { vigor: "Vigor", protegido: "Tem proteção" },
  );
  assert.deepEqual(changes, [
    { fieldId: "__name", label: "Nome da ficha", before: "Lia", after: "Lia Antiga" },
    { fieldId: "vigor", label: "Vigor", before: "3", after: "1" },
    { fieldId: "protegido", label: "Tem proteção", before: "sim", after: "não" },
  ]);
});

test("diff shows fields present on only one side as empty", () => {
  const changes = diffSheetVersions({ name: "A", values: { notas: "x" } }, { name: "A", values: { fome: 2 } });
  assert.deepEqual(changes.map((item) => [item.fieldId, item.before, item.after]), [["notas", "x", "vazio"], ["fome", "vazio", "2"]]);
});

test("history, restore and delete call the authenticated sheet routes", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, request) => {
    calls.push([url, request.method ?? "GET", request.body ?? null, request.headers.Authorization]);
    if (String(url).endsWith("/versions")) return Response.json([{ id: 1, version: 2, name: "Lia", values: {}, created_at: "2026-10-25T10:00:00Z" }, { bad: true }]);
    if (String(url).includes("/restore")) return Response.json({ id: "s1", version: 5 });
    return new Response(null, { status: 204 });
  });
  const versions = await listSheetVersions("https://api.example/", "tok", "s1");
  assert.equal(versions.length, 1, "malformed rows are dropped");
  const restored = await restoreSheetVersion("https://api.example", "tok", "s1", 2, 4);
  assert.equal(restored.version, 5);
  await deleteCampaignSheet("https://api.example", "tok", "s1", 5);
  assert.deepEqual(calls, [
    ["https://api.example/api/v1/sheets/s1/versions", "GET", null, "Bearer tok"],
    ["https://api.example/api/v1/sheets/s1/versions/2/restore", "POST", JSON.stringify({ expected_version: 4 }), "Bearer tok"],
    ["https://api.example/api/v1/sheets/s1?expected_version=5", "DELETE", null, "Bearer tok"],
  ]);
});

for (const [status, message] of [[409, /mudou em outra sessão/], [403, /não permite/], [404, /não existe mais/], [500, /indisponível/]]) {
  test(`HTTP ${status} becomes a readable message`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("internal", { status }));
    await assert.rejects(restoreSheetVersion("https://api.example", "tok", "s1", 2, 4), message);
  });
}
