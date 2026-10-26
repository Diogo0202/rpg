import assert from "node:assert/strict";
import test from "node:test";
import {
  assignableRoles,
  campaignAdminErrorMessage,
  canAdministerMember,
  deletionConfirmed,
  formatInviteCode,
  isInviteRole,
  normalizeInviteCode,
  normalizeInviteEmail,
} from "../lib/campaign-admin.ts";

const owner = { id: "o", isOwner: true, canManage: true };
const master = { id: "m", isOwner: false, canManage: true };
const player = { id: "p", isOwner: false, canManage: false };

test("invite e-mails are optional, trimmed and lowercased", () => {
  assert.equal(normalizeInviteEmail("   "), null);
  assert.equal(normalizeInviteEmail(" Lia@Example.COM "), "lia@example.com");
  assert.equal(normalizeInviteEmail("sem-arroba"), false);
});

test("invite codes accept dashes and lowercase but only 12 hex characters", () => {
  assert.equal(normalizeInviteCode("abcd-1234-ef56"), "ABCD1234EF56");
  assert.equal(normalizeInviteCode("ABCD1234EF5"), null);
  assert.equal(normalizeInviteCode("ZZZZ1234EF56"), null);
  assert.equal(formatInviteCode("ABCD1234EF56"), "ABCD-1234-EF56");
});

test("only the owner handles masters; nobody edits the owner or themselves", () => {
  assert.ok(canAdministerMember(owner, { userId: "m", role: "master" }));
  assert.ok(!canAdministerMember(master, { userId: "m2", role: "master" }));
  assert.ok(canAdministerMember(master, { userId: "p", role: "player" }));
  assert.ok(!canAdministerMember(master, { userId: "o", role: "owner" }));
  assert.ok(!canAdministerMember(master, { userId: "m", role: "guest" }));
  assert.ok(!canAdministerMember(player, { userId: "x", role: "guest" }));
  assert.deepEqual(assignableRoles(owner), ["master", "player", "guest"]);
  assert.deepEqual(assignableRoles(master), ["player", "guest"]);
  assert.ok(!isInviteRole("owner"));
});

test("deletion needs the exact campaign name", () => {
  assert.ok(deletionConfirmed("Mesa", "Mesa"));
  assert.ok(!deletionConfirmed("Mesa", "mesa"));
  assert.ok(!deletionConfirmed("", ""));
});

test("database errors become Portuguese messages", () => {
  assert.equal(campaignAdminErrorMessage({ code: "42501", message: "only the owner invites masters" }, "x"), "Só o dono da campanha pode fazer isso com mestres.");
  assert.equal(campaignAdminErrorMessage({ code: "P0002", message: "invite is not valid" }, "x"), "Convite inválido, expirado ou já usado.");
  assert.equal(campaignAdminErrorMessage({ code: "42501", message: "other" }, "x"), "Você não tem permissão para esta ação.");
  assert.equal(campaignAdminErrorMessage(null, "fallback"), "fallback");
});
