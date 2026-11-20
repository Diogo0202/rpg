import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, apiJson, apiSend, apiUrl, detailOf, errorMessage, isAbort } from "../lib/api/http.ts";

test("the base URL loses trailing slashes and the path keeps its leading one", () => {
  assert.equal(apiUrl("https://api.example//", "/api/v1/x"), "https://api.example/api/v1/x");
  assert.equal(apiUrl(" https://api.example ", "api/v1/x"), "https://api.example/api/v1/x");
});

test("a JSON body and a token become the request headers", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(url, "https://api.example/api/v1/rolls");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, "Bearer tok");
    assert.equal(request.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(request.body), { pool: 3 });
    return Response.json({ id: "r1" }, { status: 201 });
  });
  assert.deepEqual(await apiJson("https://api.example/", "/api/v1/rolls", { method: "POST", token: "tok", body: { pool: 3 } }), { id: "r1" });
});

test("a GET without body sends neither Content-Type nor Authorization", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    assert.equal(request.method, "GET");
    assert.equal(request.body, undefined);
    assert.deepEqual(request.headers, {});
    return new Response(null, { status: 204 });
  });
  const response = await apiSend("https://api.example", "/api/v1/health");
  assert.deepEqual([response.ok, response.status, response.body, response.parsed], [true, 204, null, false]);
});

test("a fixed status message wins over the server detail", () => {
  const messages = { status: { 409: "A ficha mudou." } };
  assert.equal(errorMessage({ status: 409, body: { detail: "conflict on row 12" } }, messages), "A ficha mudou.");
  assert.equal(errorMessage({ status: 422, body: { detail: "Clã inválido." } }, messages), "Clã inválido.");
  assert.equal(errorMessage({ status: 422, body: { detail: "Clã inválido." } }, { detailPrefix: "Falhou. " }), "Falhou. Clã inválido.");
  assert.equal(errorMessage({ status: 400, body: "texto" }, { rejected: "Recusado." }), "Recusado.");
  assert.equal(errorMessage({ status: 502, body: null }), "A API está indisponível. Tente novamente em instantes.");
  assert.equal(errorMessage({ status: 503, body: { detail: "db down" } }, { unavailable: "Fora do ar." }), "Fora do ar.");
  assert.equal(errorMessage({ status: 400, body: { detail: "interno" } }, { useDetail: false, rejected: "Recusado." }), "Recusado.");
});

test("the server detail is trimmed to fit the screen", () => {
  assert.equal(detailOf({ detail: "x".repeat(400) }).length, 300);
  assert.equal(detailOf({ detail: [{ msg: "lista do pydantic" }] }), null);
  assert.equal(detailOf({ detail: [{ msg: "Campo a." }, { loc: [] }] }, 300, true), "Campo a. Confira os campos enviados.");
  assert.equal(detailOf(null), null);
});

test("a refused call becomes an ApiError with status and detail", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Sem permissão." }, { status: 403 }));
  await assert.rejects(apiJson("https://api.example", "/x"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.kind, "http");
    assert.equal(error.status, 403);
    assert.equal(error.detail, "Sem permissão.");
    assert.equal(error.message, "Sem permissão.");
    return true;
  });
});

test("missing configuration and network failures carry the caller's message", async (t) => {
  await assert.rejects(apiJson("", "/x", {}, { missingApi: "Configure a API." }), { message: "Configure a API.", kind: "config" });
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(apiJson("https://api.example", "/x", {}, { network: "Sem rede." }), { message: "Sem rede.", kind: "network" });
});

test("the timeout aborts the call with its own message", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  await assert.rejects(apiJson("https://api.example", "/x", { timeoutMs: 5 }, { timeout: "Demorou." }), { message: "Demorou.", kind: "timeout" });
});

test("the caller's own cancel is reported as an abort, not as an error", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, request) => new Promise((_resolve, reject) => {
    request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  }));
  const controller = new AbortController();
  const pending = apiJson("https://api.example", "/x", { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => isAbort(error));
});

test("an injected fetch replaces the global one", async () => {
  const response = await apiSend("https://api.example", "/x", {}, {}, async () => Response.json({ ok: 1 }));
  assert.deepEqual(response.body, { ok: 1 });
});
