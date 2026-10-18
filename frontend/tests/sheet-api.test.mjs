import test from "node:test";
import assert from "node:assert/strict";
import { createCampaignSheet } from "../lib/sheet-api.ts";

const payload = { template_id: "approved-template", name: "Lia", values: { nome: "Lia", vigor: 2 } };

test("creation sends only base inputs through the authenticated campaign API", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url, "https://api.example/api/v1/campaigns/mesa/sheets");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, "Bearer session-token");
    assert.deepEqual(JSON.parse(request.body), payload);
    assert.ok(request.signal instanceof AbortSignal);
    return Response.json({ id: "sheet", ...payload, version: 1, effects: [] }, { status: 201 });
  });
  const created = await createCampaignSheet("https://api.example/", "session-token", "mesa", payload);
  assert.equal(created.id, "sheet");
  assert.deepEqual(payload.values, { nome: "Lia", vigor: 2 });
});

for (const [status, message] of [[401, /sessão expirou/], [403, /não permite/], [409, /conflito/], [429, /Limite/], [503, /indisponível/]]) {
  test(`creation explains HTTP ${status} without exposing the response`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response("internal database information", { status }));
    await assert.rejects(createCampaignSheet("https://api.example", "token", "mesa", payload), message);
  });
}

test("field validation failure keeps a readable server message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Clã: escolha uma opção válida." }, { status: 422 }));
  await assert.rejects(createCampaignSheet("https://api.example", "token", "mesa", payload), /Clã: escolha/);
});

test("network failure leaves the caller's draft unchanged", async (t) => {
  const before = structuredClone(payload);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("network error"); });
  await assert.rejects(createCampaignSheet("https://api.example", "token", "mesa", payload), /preenchimento continua/);
  assert.deepEqual(payload, before);
});

test("an incomplete success response is not selected as a character", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  await assert.rejects(createCampaignSheet("https://api.example", "token", "mesa", payload), /não confirmou/);
});

test("a malformed response does not leak parser details", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>proxy</html>"));
  await assert.rejects(createCampaignSheet("https://api.example", "token", "mesa", payload), /não pôde ser confirmada/);
});
