import assert from "node:assert/strict";
import test from "node:test";
import { buildCopyrightReport, copyrightReportPath, emptyCopyrightDraft } from "../lib/marketplace-copyright.ts";

const valid = { reason: "Reproduz o texto integral do livro.", claimedWork: " Livro Básico ", rightsHolder: "Editora Exemplo", evidenceUrl: "", goodFaith: true };

test("copyright report builds a trimmed payload with optional link", () => {
  assert.deepEqual(buildCopyrightReport(valid), { ok: true, payload: {
    reason: "Reproduz o texto integral do livro.", claimed_work: "Livro Básico", rights_holder: "Editora Exemplo", evidence_url: null, good_faith: true,
  } });
  const withLink = buildCopyrightReport({ ...valid, evidenceUrl: " https://example.test/obra " });
  assert.equal(withLink.ok && withLink.payload.evidence_url, "https://example.test/obra");
});

test("good faith statement, work and holder are mandatory", () => {
  assert.equal(buildCopyrightReport(emptyCopyrightDraft).ok, false);
  assert.equal(buildCopyrightReport({ ...valid, goodFaith: false }).ok, false);
  assert.equal(buildCopyrightReport({ ...valid, claimedWork: " " }).ok, false);
  assert.equal(buildCopyrightReport({ ...valid, rightsHolder: "" }).ok, false);
  assert.equal(buildCopyrightReport({ ...valid, reason: "curto" }).ok, false);
});

test("links must be http(s) and attachments are refused", () => {
  for (const evidenceUrl of ["javascript:alert(1)", "ftp://example.test/a.pdf", "data:application/pdf;base64,JVBERi0x", "https://exa mple.test"]) {
    assert.equal(buildCopyrightReport({ ...valid, evidenceUrl }).ok, false, evidenceUrl);
  }
  assert.equal(buildCopyrightReport({ ...valid, reason: "Anexo: data:application/pdf;base64,JVBERi0xLjQK" }).ok, false);
});

test("report path targets the copyright endpoint", () => {
  assert.equal(copyrightReportPath("a/b"), "/api/v1/marketplace/systems/a%2Fb/report/copyright");
});
