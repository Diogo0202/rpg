import test from "node:test";
import assert from "node:assert/strict";
import { printableSheetHtml } from "../lib/printable-sheet.ts";
import { checkedAudioUrl } from "../lib/audio-url.ts";

test("printable sheet escapes imported text and applies a restrictive CSP", () => {
  const payload = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const html = printableSheetHtml({
    name: `</title>${payload}`,
    template: { name: "Template", version: 1, fields: [{ id: "notes", label: payload, kind: "text", required: false, options: [], expression: null }] },
    values: { notes: payload },
    effects: [{ id: "e1", label: payload, delta: 1, enabled: true, applies_to_tags: [], exempt_tags: [], remaining_scenes: null, source_note: null }],
    inventory: [{ name: payload, category: "equipment", quantity: 1, resource_cost: 0, damage_bonus: 0, protection: 0, notes: payload, acquired: true, equipped: false, sort_order: 0 }],
  });

  assert.match(html, /default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'/);
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(!html.includes("<img src=x onerror="));
  assert.ok(!html.includes("<script>alert(1)</script>"));
});

test("audio URLs accept HTTPS without credentials and reject executable or malformed schemes", () => {
  assert.equal(checkedAudioUrl("https://audio.example/track.mp3"), "https://audio.example/track.mp3");
  assert.equal(checkedAudioUrl("javascript:alert(1)"), null);
  assert.equal(checkedAudioUrl("data:audio/mp3;base64,AAAA"), null);
  assert.equal(checkedAudioUrl("http://audio.example/track.mp3"), null);
  assert.equal(checkedAudioUrl("https://user:pass@audio.example/track.mp3"), null);
  assert.equal(checkedAudioUrl(`https://audio.example/${"a".repeat(2050)}`), null);
});
