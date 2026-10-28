import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AD_ROUTE_FORMATS, adPlacement, adSenseCspSources, adSenseScriptUrl, getAdSenseConfig, normalizeAdPath, routeAllowsAds } from "../lib/ads.ts";
import { AFFILIATE_REL, AFFILIATE_SYSTEMS, affiliateLinks, getAffiliateConfig } from "../lib/affiliate-links.ts";

const ENV = {
  NEXT_PUBLIC_ADSENSE_ENABLED: "true",
  NEXT_PUBLIC_ADSENSE_CLIENT_ID: "ca-pub-1234567890123456",
  NEXT_PUBLIC_ADSENSE_SLOT_INLINE: "1234567890",
  NEXT_PUBLIC_ADSENSE_SLOT_STICKY: "9876543210",
};
const config = getAdSenseConfig(ENV);
const base = { pathname: "/", format: "inline", config, consent: "accepted" };

test("AdSense stays off without explicit flag, valid client and a valid slot", () => {
  assert.equal(getAdSenseConfig({}).enabled, false);
  assert.equal(getAdSenseConfig({ ...ENV, NEXT_PUBLIC_ADSENSE_ENABLED: "false" }).enabled, false);
  assert.equal(getAdSenseConfig({ ...ENV, NEXT_PUBLIC_ADSENSE_CLIENT_ID: "pub-123" }).enabled, false);
  assert.equal(getAdSenseConfig({ ...ENV, NEXT_PUBLIC_ADSENSE_SLOT_INLINE: "x", NEXT_PUBLIC_ADSENSE_SLOT_STICKY: "" }).enabled, false);
  assert.deepEqual(getAdSenseConfig({ ...ENV, NEXT_PUBLIC_ADSENSE_SLOT_STICKY: "bad" }).slots, { inline: "1234567890", "sticky-bottom": null });
  assert.deepEqual(adPlacement({ ...base, config: getAdSenseConfig({}) }), { show: false, reason: "disabled" });
});

test("ads only show after consent", () => {
  assert.deepEqual(adPlacement({ ...base, consent: null }), { show: false, reason: "consent" });
  assert.deepEqual(adPlacement({ ...base, consent: "declined" }), { show: false, reason: "consent" });
  assert.deepEqual(adPlacement(base), { show: true, slot: "1234567890" });
});

test("only inline and sticky bottom formats exist; pop-up, vignette, interstitial and video are refused", () => {
  for (const format of ["popup", "vignette", "fullscreen", "interstitial", "anchor-auto", "side-rail", "autoplay-video"]) {
    assert.deepEqual(adPlacement({ ...base, format }), { show: false, reason: "format" });
  }
  assert.deepEqual(adPlacement({ ...base, format: "sticky-bottom" }), { show: true, slot: "9876543210" });
});

test("ads never appear in the authenticated play area, login, auth or dev routes", () => {
  for (const pathname of ["/app", "/app/campaign/abc", "/app/perfil", "/login", "/auth/callback", "/dev/map-editor"]) {
    assert.deepEqual(adPlacement({ ...base, pathname }), { show: false, reason: "route" }, pathname);
    assert.equal(routeAllowsAds(pathname, "inline", config), false);
  }
  assert.deepEqual(Object.keys(AD_ROUTE_FORMATS).sort(), ["/", "/marketplace"]);
  assert.deepEqual(adPlacement({ ...base, pathname: "/marketplace/" }), { show: true, slot: "1234567890" });
  assert.deepEqual(adPlacement({ ...base, pathname: "/marketplace", format: "sticky-bottom" }), { show: false, reason: "route" });
  assert.equal(normalizeAdPath("/marketplace/?q=1"), "/marketplace");
});

test("ads hide during combat or rolls and the sticky ad stays closed once dismissed", () => {
  assert.deepEqual(adPlacement({ ...base, activeCombat: true }), { show: false, reason: "gameplay" });
  assert.deepEqual(adPlacement({ ...base, rolling: true }), { show: false, reason: "gameplay" });
  assert.deepEqual(adPlacement({ ...base, format: "sticky-bottom", stickyDismissed: true }), { show: false, reason: "dismissed" });
  assert.deepEqual(adPlacement({ ...base, stickyDismissed: true }), { show: true, slot: "1234567890" });
});

test("script URL and CSP additions exist only when enabled", () => {
  assert.equal(adSenseScriptUrl("ca-pub-1234567890123456"), "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1234567890123456");
  assert.deepEqual(adSenseCspSources(getAdSenseConfig({})), {});
  assert.ok(adSenseCspSources(config)["script-src"].includes("https://pagead2.googlesyndication.com"));
});

test("ad component pushes no page-level config, reserves space and is dismissible", async () => {
  const source = await readFile(new URL("../components/ad-slot.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /enable_page_level_ads|overlays|vignette:\s*true/);
  assert.match(source, /\.push\(\{\}\)/);
  assert.match(source, /requestNonPersonalizedAds = 1/);
  assert.match(source, /aria-label="Fechar anúncio"/);
  assert.match(source, /function readConsent\(\)[\s\S]*?try\s*\{/);
  assert.match(source, /AD_RESERVED_HEIGHT/);
});

test("affiliate links stay absent without IDs and reject malformed IDs", () => {
  assert.deepEqual(affiliateLinks(null, {}), []);
  assert.deepEqual(affiliateLinks(null, { NEXT_PUBLIC_AMAZON_AFFILIATE_TAG: "bad tag&x=1", NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID: "12a" }), []);
  assert.equal(getAffiliateConfig({ NEXT_PUBLIC_AMAZON_STORE_DOMAIN: "amazon.evil.test" }).amazonDomain, "amazon.com.br");
});

test("affiliate links are built per system with only the store's affiliate parameter", () => {
  const env = { NEXT_PUBLIC_AMAZON_AFFILIATE_TAG: "rpgatlas-20", NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID: "4321" };
  const links = affiliateLinks("vampire-v5", env);
  assert.equal(links.length, 2);
  const amazon = new URL(links.find((link) => link.store === "amazon").href);
  assert.equal(amazon.hostname, "www.amazon.com.br");
  assert.deepEqual([...amazon.searchParams.keys()].sort(), ["k", "tag"]);
  assert.equal(amazon.searchParams.get("tag"), "rpgatlas-20");
  const dtrpg = new URL(links.find((link) => link.store === "drivethrurpg").href);
  assert.equal(dtrpg.hostname, "www.drivethrurpg.com");
  assert.deepEqual([...dtrpg.searchParams.keys()].sort(), ["affiliate_id", "keyword"]);
  assert.equal(dtrpg.searchParams.get("affiliate_id"), "4321");
  assert.equal(affiliateLinks(null, env).length, AFFILIATE_SYSTEMS.length * 2);
  assert.deepEqual(affiliateLinks("unknown-system", env), []);
  assert.equal(affiliateLinks("hunter", { NEXT_PUBLIC_DRIVETHRURPG_AFFILIATE_ID: "1" })[0].store, "drivethrurpg");
  assert.equal(new URL(affiliateLinks("one-ring", { ...env, NEXT_PUBLIC_AMAZON_STORE_DOMAIN: "amazon.com" })[0].href).hostname, "www.amazon.com");
});

test("affiliate component marks links as sponsored and shows a visible disclosure", async () => {
  assert.equal(AFFILIATE_REL, "sponsored noopener noreferrer");
  const source = await readFile(new URL("../components/affiliate-links.tsx", import.meta.url), "utf8");
  assert.match(source, /rel=\{AFFILIATE_REL\}/);
  assert.match(source, /AFFILIATE_DISCLOSURE/);
  assert.doesNotMatch(source, /onClick|sendBeacon|fetch\(/);
});
