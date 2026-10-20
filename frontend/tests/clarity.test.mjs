import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getClarityConfig } from "../lib/clarity.ts";

test("Clarity stays off without explicit enablement and a project identifier", () => {
  const oldEnabled = process.env.NEXT_PUBLIC_CLARITY_ENABLED;
  const oldId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
  delete process.env.NEXT_PUBLIC_CLARITY_ENABLED;
  delete process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
  assert.deepEqual(getClarityConfig(), { enabled: false, projectId: null });
  process.env.NEXT_PUBLIC_CLARITY_ENABLED = "true";
  process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID = "bad";
  assert.deepEqual(getClarityConfig(), { enabled: false, projectId: null });
  if (oldEnabled === undefined) delete process.env.NEXT_PUBLIC_CLARITY_ENABLED;
  else process.env.NEXT_PUBLIC_CLARITY_ENABLED = oldEnabled;
  if (oldId === undefined) delete process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;
  else process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID = oldId;
});

test("only grants analytics consent and protects transitions to private routes", async () => {
  const source = await readFile(new URL("../components/clarity-consent.tsx", import.meta.url), "utf8");
  assert.match(source, /ad_Storage:\s*"denied",\s*analytics_Storage:\s*"granted"/);
  assert.match(source, /analytics_Storage:\s*"denied"/);
  assert.match(source, /addEventListener\("click", navigatePrivatelyWithDocument, true\)/);
  assert.match(source, /window\.location\.assign\(destination\.href\)/);
  assert.match(source, /window\.location\.reload\(\)/);
  assert.match(source, /function readChoice\(\)[\s\S]*?try\s*\{/);
});
