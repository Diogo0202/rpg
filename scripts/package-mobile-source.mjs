import { readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Explicit source allowlist: never include environment files or working-tree archives.
const sources = [
  "docs/LOVABLE_MOBILE_BRIEF.md", "docs/MOBILE_SYNC_CONTRACT.md", "docs/MOBILE_SYNC_CLIENT.md",
  ...["types", "merge", "store", "engine", "transport", "index"].map((name) => `mobile/src/lib/mobile-sync/${name}.ts`),
  ...["sheet-template", "sheet-creation", "sheet-backup", "system-starters"].map((name) => `frontend/lib/${name}.ts`),
];
const manifest = [];
for (const source of sources) {
  const content = (await readFile(path.join(root, source), "utf8")).replace(/\r\n/g, "\n");
  manifest.push({ path: source, target: source.replace(/^frontend\//, "src/").replace(/^mobile\//, ""), sha256: createHash("sha256").update(content).digest("hex"), content });
}
const folder = path.join(tmpdir(), "rpg-nexus-mobile-delivery");
await mkdir(folder, { recursive: true });
const output = path.join(folder, "rpg-nexus-mobile-source.json");
const serialized = JSON.stringify({ format: "rpg-nexus-mobile-source", version: 1, files: manifest }, null, 2);
await writeFile(output, serialized);
console.log(JSON.stringify({ output, files: sources.length, bytes: Buffer.byteLength(serialized), manifest: manifest.map(({ content: _content, ...item }) => item) }));
