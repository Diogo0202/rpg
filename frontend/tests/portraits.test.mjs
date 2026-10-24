import assert from "node:assert/strict";
import { test } from "node:test";
import { initials, parsePortraitPath, portraitObjectPath, squareCrop, validatePortraitFile } from "../lib/portraits.ts";

const CAMPAIGN = "23000000-0000-0000-0000-000000000001";
const USER = "13000000-0000-0000-0000-000000000001";
const OBJECT = "53000000-0000-0000-0000-000000000001";

test("portrait files are limited to JPG, PNG and WebP up to 10 MB", () => {
  assert.equal(validatePortraitFile({ type: "image/jpeg", size: 2_000_000 }), "");
  assert.match(validatePortraitFile({ type: "image/gif", size: 10 }), /JPG, PNG ou WebP/);
  assert.match(validatePortraitFile({ type: "image/png", size: 0 }), /vazio/);
  assert.match(validatePortraitFile({ type: "image/webp", size: 11 * 1024 * 1024 }), /10 MB/);
});

test("portrait paths follow campaign/uploader/object.webp", () => {
  const path = portraitObjectPath(CAMPAIGN, USER, OBJECT);
  assert.equal(path, `${CAMPAIGN}/${USER}/${OBJECT}.webp`);
  assert.deepEqual(parsePortraitPath(path), { campaignId: CAMPAIGN, uploaderId: USER });
  assert.equal(parsePortraitPath(`../${USER}/${OBJECT}.webp`), null);
  assert.equal(parsePortraitPath(`${CAMPAIGN}/${USER}/${OBJECT}.png`), null);
});

test("portraits are cropped to the centred square and fall back to initials", () => {
  assert.deepEqual(squareCrop(1200, 800), { sx: 200, sy: 0, size: 800 });
  assert.deepEqual(squareCrop(600, 900), { sx: 0, sy: 150, size: 600 });
  assert.equal(initials("Lia Vale da Serra"), "LS");
  assert.equal(initials("bruxa"), "B");
  assert.equal(initials("  "), "?");
});
