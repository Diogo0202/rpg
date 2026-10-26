import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyChatChange, canDeleteMessage, CHAT_MAX_LENGTH, chatErrorMessage, chatTopic, mergeMessages, messageVisibility,
  parseChatMessage, privateRecipients, resyncMessages, setMessageStatus, sortMessages, validateChatDraft, authorLabel,
} from "../lib/campaign-chat.ts";

const CAMPAIGN = "2c000000-0000-0000-0000-000000000001";
const OTHER = "2c000000-0000-0000-0000-000000000002";
const NARRATOR = "1c000000-0000-0000-0000-000000000001";
const PLAYER = "1c000000-0000-0000-0000-000000000002";
const PLAYER2 = "1c000000-0000-0000-0000-000000000003";

function msg(n, overrides = {}) {
  return {
    id: `3c000000-0000-0000-0000-${String(n).padStart(12, "0")}`,
    campaign_id: CAMPAIGN, author_id: PLAYER, author_name: "Jogadora", author_role: "jogador",
    recipient_id: null, body: `mensagem ${n}`, created_at: new Date(Date.UTC(2026, 9, 26, 20, 0, n)).toISOString(), edited_at: null,
    ...overrides,
  };
}

test("parseChatMessage validates untrusted rows", () => {
  assert.deepEqual(parseChatMessage(msg(1)), msg(1));
  assert.equal(parseChatMessage(null), null);
  assert.equal(parseChatMessage({ ...msg(1), id: "x" }), null);
  assert.equal(parseChatMessage({ ...msg(1), body: 3 }), null);
  assert.equal(parseChatMessage({ ...msg(1), created_at: "ontem" }), null);
  assert.equal(parseChatMessage({ ...msg(1), recipient_id: "not-a-uuid" }), null);
  assert.equal(parseChatMessage({ ...msg(1), author_role: "admin" }).author_role, "convidado");
  assert.equal(parseChatMessage({ ...msg(1), body: "a".repeat(3000) }).body.length, CHAT_MAX_LENGTH);
  assert.equal(parseChatMessage({ ...msg(1), status: "sending" }).status, undefined, "status never comes from the server");
});

test("sortMessages orders chronologically with a stable id tie-break", () => {
  const same = msg(5).created_at;
  const rows = [msg(3), msg(1), { ...msg(9), created_at: same }, msg(5)];
  assert.deepEqual(sortMessages(rows).map((row) => row.body), ["mensagem 1", "mensagem 3", "mensagem 5", "mensagem 9"]);
});

test("mergeMessages dedupes, prefers server and latest edit, and trims to the limit", () => {
  const pending = { ...msg(2), status: "sending" };
  let rows = mergeMessages([msg(1), pending], [msg(2)]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].status, undefined, "server echo replaces optimistic copy");
  rows = mergeMessages(rows, [{ ...msg(2), status: "sending" }]);
  assert.equal(rows[1].status, undefined, "a stale optimistic copy does not overwrite the server copy");
  const edited = { ...msg(1), body: "editada", edited_at: "2026-10-26T21:00:00.000Z" };
  rows = mergeMessages(rows, [edited]);
  assert.equal(rows[0].body, "editada");
  rows = mergeMessages(rows, [msg(1)]);
  assert.equal(rows[0].body, "editada", "an older unedited copy does not revert the edit");

  const many = Array.from({ length: 10 }, (_, i) => msg(i + 1));
  const trimmed = mergeMessages([{ ...msg(50), status: "failed" }], many, 3);
  assert.deepEqual(trimmed.map((row) => row.body), ["mensagem 8", "mensagem 9", "mensagem 10", "mensagem 50"], "keeps newest confirmed plus local");
});

test("resyncMessages replaces confirmed rows with the snapshot and keeps local sends", () => {
  const rows = [msg(1), msg(2), { ...msg(3), status: "failed" }];
  const next = resyncMessages(rows, [msg(2), msg(4)]);
  assert.deepEqual(next.map((row) => row.body), ["mensagem 2", "mensagem 3", "mensagem 4"], "message 1 was deleted while offline");
});

test("applyChatChange handles insert, update, delete and ignores foreign rows", () => {
  let rows = applyChatChange([], { eventType: "INSERT", new: msg(1) }, CAMPAIGN);
  assert.equal(rows.length, 1);
  rows = applyChatChange(rows, { eventType: "INSERT", new: msg(1) }, CAMPAIGN);
  assert.equal(rows.length, 1, "duplicate insert is ignored");
  rows = applyChatChange(rows, { eventType: "INSERT", new: { ...msg(2), campaign_id: OTHER } }, CAMPAIGN);
  assert.equal(rows.length, 1, "other campaign is ignored");
  rows = applyChatChange(rows, { eventType: "INSERT", new: { id: "bad" } }, CAMPAIGN);
  assert.equal(rows.length, 1, "malformed row is ignored");
  rows = applyChatChange(rows, { eventType: "UPDATE", new: { ...msg(1), body: "nova", edited_at: "2026-10-26T22:00:00.000Z" } }, CAMPAIGN);
  assert.equal(rows[0].body, "nova");
  rows = applyChatChange(rows, { eventType: "DELETE", old: { id: msg(1).id } }, CAMPAIGN);
  assert.equal(rows.length, 0);
  assert.equal(applyChatChange([msg(1)], { eventType: "DELETE", old: null }, CAMPAIGN).length, 1);
});

test("setMessageStatus marks a local send", () => {
  const rows = setMessageStatus([{ ...msg(1), status: "sending" }], msg(1).id, "failed");
  assert.equal(rows[0].status, "failed");
});

test("validateChatDraft trims, strips control characters and enforces the limit", () => {
  assert.deepEqual(validateChatDraft("  olá\r\nmesa \u0007"), { ok: true, body: "olá\nmesa" });
  assert.equal(validateChatDraft("   ").ok, false);
  assert.equal(validateChatDraft("a".repeat(CHAT_MAX_LENGTH)).ok, true);
  assert.equal(validateChatDraft("a".repeat(CHAT_MAX_LENGTH + 1)).ok, false);
  assert.deepEqual(validateChatDraft("<b>oi</b>"), { ok: true, body: "<b>oi</b>" }, "HTML is kept as text, never interpreted");
});

test("privateRecipients mirrors the database rule", () => {
  const people = [
    { userId: NARRATOR, name: "Narradora", role: "narrador" },
    { userId: PLAYER, name: "Ana", role: "jogador" },
    { userId: PLAYER2, name: "Bia", role: "jogador" },
  ];
  assert.deepEqual(privateRecipients(people, PLAYER).map((p) => p.userId), [NARRATOR]);
  assert.deepEqual(privateRecipients(people, NARRATOR).map((p) => p.userId), [PLAYER, PLAYER2]);
  assert.deepEqual(privateRecipients(people, "1c000000-0000-0000-0000-000000000009"), []);
});

test("visibility, delete permission and labels", () => {
  const whisper = msg(1, { author_id: NARRATOR, author_role: "narrador", recipient_id: PLAYER });
  assert.equal(messageVisibility(msg(2), PLAYER), "public");
  assert.equal(messageVisibility(whisper, PLAYER), "private-received");
  assert.equal(messageVisibility(whisper, NARRATOR), "private-sent");
  assert.equal(canDeleteMessage(msg(2), PLAYER, false), true, "author deletes own");
  assert.equal(canDeleteMessage(msg(2), PLAYER2, false), false, "others cannot");
  assert.equal(canDeleteMessage(msg(2), NARRATOR, true), true, "managers moderate");
  assert.equal(canDeleteMessage({ ...msg(2), status: "sending" }, PLAYER, true), false, "in-flight sends cannot be deleted");
  assert.equal(canDeleteMessage({ ...msg(2), status: "failed" }, PLAYER, false), true, "failed sends can be discarded");
  assert.equal(authorLabel(msg(2), PLAYER), "Você");
  assert.equal(authorLabel(msg(2, { author_name: "  " }), PLAYER2), "Membro da campanha");
});

test("chatErrorMessage and chatTopic", () => {
  assert.match(chatErrorMessage({ code: "P0429" }), /Aguarde/);
  assert.match(chatErrorMessage({ code: "42501" }), /permissão/);
  assert.match(chatErrorMessage(null), /servidor/);
  assert.equal(chatTopic(CAMPAIGN), `campaign-chat-${CAMPAIGN}`);
});
