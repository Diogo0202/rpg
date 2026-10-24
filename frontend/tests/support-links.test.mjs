import assert from "node:assert/strict";
import test from "node:test";
import { supportLinks } from "../lib/support-links.ts";

test("support links stay absent without configuration", () => {
  assert.deepEqual(supportLinks({}), []);
});
test("support links reject scripts, credentials and fake store domains", () => {
  assert.deepEqual(supportLinks({ DONATION_URL: "javascript:alert(1)", AMAZON_BOOKS_URL: "https://amazon.com.evil.test/book", DRIVETHRURPG_BOOKS_URL: "https://user:secret@www.drivethrurpg.com/book" }), []);
});
test("configured books retain affiliate parameters without inventing them", () => {
  const links = supportLinks({ AMAZON_BOOKS_URL: "https://www.amazon.com.br/book?tag=provided", DRIVETHRURPG_BOOKS_URL: "https://www.drivethrurpg.com/product/123" });
  assert.equal(links.length, 2);
  assert.equal(new URL(links[0].href).searchParams.get("tag"), "provided");
  assert.ok(links.every((link) => link.affiliate));
});
