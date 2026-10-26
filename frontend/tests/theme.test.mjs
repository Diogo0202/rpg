import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { readThemeMode } from "../lib/theme.ts";

function withSavedTheme(value, run) {
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => value } };
  try { return run(); } finally { globalThis.window = previous; }
}

test("tema salvo aceita Demon Lord e recusa valores desconhecidos", () => {
  assert.equal(withSavedTheme("demon-lord", readThemeMode), "demon-lord");
  assert.equal(withSavedTheme("hunter", readThemeMode), "hunter");
  assert.equal(withSavedTheme("vampiro-roxo", readThemeMode), "standard");
  assert.equal(withSavedTheme(null, readThemeMode), "standard");
});

function luminance(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const block = css.match(/:root\[data-theme="demon-lord"\] \{([^}]*)\}/)[1];
const tokens = Object.fromEntries([...block.matchAll(/--([a-z]+):(#[0-9a-f]{6})/gi)].map(([, name, value]) => [name, value]));

test("paleta Demon Lord passa AA (4,5:1) nos pares de texto", () => {
  const pairs = [
    ["tinta / pergaminho", tokens.ink, tokens.paper],
    ["tinta / painel", tokens.ink, tokens.panel],
    ["sépia apagada / pergaminho", tokens.muted, tokens.paper],
    ["sangue / painel", tokens.accent, tokens.panel],
    ["pergaminho / sangue", tokens.paper, tokens.accent],
    ["ouro sacro / lama", "#c9a14a", "#15130f"],
    ["pergaminho / lama", "#ebe0c9", "#15130f"],
    ["texto claro / ferro gasto", "#d8ccb4", "#2a241c"],
  ];
  for (const [name, foreground, background] of pairs) {
    assert.ok(contrast(foreground, background) >= 4.5, `${name}: ${contrast(foreground, background).toFixed(2)}:1`);
  }
});
