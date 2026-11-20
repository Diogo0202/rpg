import { describe, expect, it } from "vitest";
import type { SyncRecord } from "@/lib/mobile-sync";
import { pretty, reapplyOnBase, statusLabel } from "./sync-model";

describe("sync model", () => {
  it("labels known states and keeps unknown ones as they are", () => {
    expect(statusLabel("conflict")).toBe("conflito");
    expect(statusLabel("novo")).toBe("novo");
  });

  it("prints absent and null values differently", () => {
    expect(pretty({ exists: false })).toBe("(ausente)");
    expect(pretty({ exists: true, value: null })).toBe("null");
  });

  it("rebases each draft field on the received record", () => {
    const base: SyncRecord = { entity_type: "maps", id: "m", version: 3, data: { name: "Novo", grid: { size: 5 } } };
    const changes = reapplyOnBase([
      { path: ["name"], before: { exists: true, value: "Velho" }, after: { exists: true, value: "Meu" } },
      { path: ["grid", "color"], before: { exists: false }, after: { exists: true, value: "red" } },
    ], base);
    expect(changes.map((change) => change.before)).toEqual([{ exists: true, value: "Novo" }, { exists: false }]);
    expect(changes[0]!.after).toEqual({ exists: true, value: "Meu" });
  });
});
