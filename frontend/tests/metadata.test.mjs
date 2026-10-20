import test from "node:test";
import assert from "node:assert/strict";
import { getSiteMetadataConfig, isPublicSiteUrl, parseSiteUrl, escapeJsonForHtml } from "../lib/site-metadata.ts";

test("requires an http or https URL without credentials", () => {
  assert.equal(parseSiteUrl("javascript:alert(1)"), null);
  assert.equal(parseSiteUrl("https://user:pass@site.test"), null);
  assert.equal(parseSiteUrl("https://rpg.example.test")?.hostname, "rpg.example.test");
});

test("withholds local and example domains from production indexing", () => {
  assert.equal(isPublicSiteUrl(new URL("https://localhost"), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://localhost."), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://example.com."), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://10.0.0.1."), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://dev.example"), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://rpg.example.test"), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://example.com"), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://192.168.1.20"), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://[fd00::1]"), true), false);
  assert.equal(isPublicSiteUrl(new URL("https://rpgnexus.dev"), true), true);
  assert.equal(isPublicSiteUrl(new URL("http://rpg.test"), true), false);
});

test("normalizes a configured public URL to its origin", () => {
  const oldUrl = process.env.SITE_URL;
  const oldMode = process.env.NODE_ENV;
  process.env.SITE_URL = "https://rpgnexus.dev/path?token=discard#section";
  process.env.NODE_ENV = "production";
  try {
    const config = getSiteMetadataConfig();
    assert.equal(config.publicUrl?.toString(), "https://rpgnexus.dev/");
    assert.equal(config.indexable, true);
  } finally {
    if (oldUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = oldUrl;
    if (oldMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = oldMode;
  }
});

test("uses local metadata base for development without enabling indexing", () => {
  const previousUrl = process.env.SITE_URL;
  const previousMode = process.env.NODE_ENV;
  delete process.env.SITE_URL;
  process.env.NODE_ENV = "development";
  const config = getSiteMetadataConfig();
  assert.equal(config.metadataBase?.toString(), "http://localhost:3000/");
  assert.equal(config.publicUrl, null);
  assert.equal(config.indexable, false);
  if (previousUrl === undefined) delete process.env.SITE_URL;
  else process.env.SITE_URL = previousUrl;
  if (previousMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousMode;
});

test("escapes less-than characters in schema JSON", () => {
  assert.equal(escapeJsonForHtml({ value: "</script>" }), '{"value":"\\u003c/script>"}');
});
