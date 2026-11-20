import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyProposalDraft, mergeCompendiumEntries, originLabel, parseCompendiumTags, rowToCompendiumEntry, splitReviewRows, validateCompendiumProposal,
} from "../lib/campaign-compendium.ts";
import { searchCompendiumEntries } from "../lib/compendium-search.ts";

const CAMPAIGN = "ce100000-0000-4000-8000-000000000001";
const local = [
  { id: "homebrew-a", title: "Limiar de Cinza", type: "discipline", level: 1, tags: ["homebrew"], cost: "x", pool: "y", duration: "z", description: "local", source: { title: "Homebrew demonstrativo", kind: "homebrew" } },
  { id: "homebrew-b", title: "Rosto de Domingo", type: "discipline", level: 2, tags: ["homebrew"], cost: "x", pool: "y", duration: "z", description: "local", source: { title: "Homebrew demonstrativo", kind: "homebrew" } },
];
const row = (overrides) => ({
  id: "r1", campaign_id: CAMPAIGN, proposed_by: "u1", title: "Eco da Vigília", entry_type: "advantage", level: 2, tags: ["mesa"],
  cost: "", pool: "Raciocínio", duration: "Uma cena", description: "Texto da mesa.", source_title: "Caderno", source_page: 12,
  source_kind: "homebrew", status: "approved", review_note: null, reviewed_at: "2026-10-25T00:00:00Z", created_at: "2026-10-25T00:00:00Z", updated_at: "2026-10-25T00:00:00Z",
  ...overrides,
});

test("only approved campaign rows are merged, with campaign origin and page", () => {
  const merged = mergeCompendiumEntries(local, [row({}), row({ id: "r2", title: "Pendente", status: "pending" }), row({ id: "r3", title: "Rejeitado", status: "rejected" })]);
  assert.deepEqual(merged.map((entry) => entry.title), ["Eco da Vigília", "Limiar de Cinza", "Rosto de Domingo"]);
  assert.equal(merged[0].origin, "campaign");
  assert.equal(merged[0].source.page, 12);
  assert.equal(merged[0].cost, "Não informado");
  assert.equal(merged[1].origin, "local");
});

test("approved campaign entry replaces a local example with the same title", () => {
  const merged = mergeCompendiumEntries(local, [row({ title: "LIMIAR DE CINZA" })]);
  assert.equal(merged.length, 2);
  assert.equal(merged.filter((entry) => entry.title.toLowerCase() === "limiar de cinza")[0].origin, "campaign");
});

test("origin label distinguishes campaign and local entries", () => {
  assert.match(originLabel(rowToCompendiumEntry(row({ source_kind: "licensed" }))), /^Campanha.*Caderno, página 12 \(licença declarada\)$/);
  assert.match(originLabel({ ...local[0], origin: "local" }), /^Acervo local/);
});

test("proposal validation builds the RPC payload and rejects bad input", () => {
  const draft = { ...emptyProposalDraft(), title: "  Eco ", level: "3", tags: "Mesa, mesa, Noite", description: " Texto próprio ", sourceTitle: "Caderno", sourcePage: "7" };
  const { payload, errors } = validateCompendiumProposal(CAMPAIGN, draft);
  assert.deepEqual(errors, []);
  assert.equal(payload.p_title, "Eco");
  assert.equal(payload.p_level, 3);
  assert.deepEqual(payload.p_tags, ["mesa", "noite"]);
  assert.equal(payload.p_source_page, 7);
  assert.equal(payload.p_campaign_id, CAMPAIGN);

  const bad = validateCompendiumProposal(CAMPAIGN, { ...emptyProposalDraft(), level: "9", sourcePage: "0" });
  assert.equal(bad.payload, undefined);
  assert.equal(bad.errors.length, 5);
  assert.ok(validateCompendiumProposal(CAMPAIGN, { ...draft, sourceKind: "licensed", sourcePage: "" }).errors.some((error) => error.includes("página")));
});

test("tags parse ignores blanks and duplicates", () => {
  assert.deepEqual(parseCompendiumTags(" a, ,B, b "), ["a", "b"]);
});

test("review split shows pending queue and the viewer's non-approved proposals", () => {
  const rows = [row({ id: "1", status: "pending", proposed_by: "me" }), row({ id: "2", status: "rejected", proposed_by: "me" }), row({ id: "3", status: "pending", proposed_by: "other" }), row({ id: "4", proposed_by: "me" })];
  const { pending, mine } = splitReviewRows(rows, "me");
  assert.deepEqual(pending.map((item) => item.id), ["1", "3"]);
  assert.deepEqual(mine.map((item) => item.id), ["1", "2"]);
});

test("busca encontra a fonte do verbete aprovado", () => {
  const entries = mergeCompendiumEntries(local, [row({ source_title: "Caderno da Noite" })]);
  assert.deepEqual(searchCompendiumEntries("Caderno da Noite", entries).map((entry) => entry.title), ["Eco da Vigília"]);
});
