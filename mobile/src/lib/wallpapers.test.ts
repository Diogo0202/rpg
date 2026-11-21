import { describe, expect, it } from "vitest";
import { parseWallpaper, wallpaperKey, wallpaperSlotsFor, WALLPAPER_MAX_CHARS } from "./wallpapers";

const IMAGE = { data: "data:image/jpeg;base64,QUJD", name: "taverna.jpg", width: 1600, height: 900 };

describe("wallpapers", () => {
  it("uses the general wallpaper only on the Mesa and Fichas start screens", () => {
    expect(wallpaperSlotsFor("/fichas", "camp-a")).toEqual([{ kind: "home" }]);
    expect(wallpaperSlotsFor("/", "camp-a")).toEqual([{ kind: "table", campaignId: "camp-a" }, { kind: "home" }]);
    for (const path of ["/dados", "/mundo", "/mais", "/fichas/nova", "/sincronizacao"]) expect(wallpaperSlotsFor(path, "camp-a")).toEqual([]);
  });

  it("shows only the character image inside an open sheet", () => {
    expect(wallpaperSlotsFor("/fichas", "camp-a", "ana")).toEqual([{ kind: "sheet", campaignId: "camp-a", sheetId: "ana" }]);
  });

  it("keeps table photos and character images apart per campaign", () => {
    expect(wallpaperKey({ kind: "home" })).toBe("wallpaper-v1:home");
    expect(wallpaperKey({ kind: "table", campaignId: "camp-a" })).not.toBe(wallpaperKey({ kind: "table", campaignId: "camp-b" }));
    expect(wallpaperKey({ kind: "sheet", campaignId: "camp-a", sheetId: "ana" })).toBe("wallpaper-v1:sheet:camp-a:ana");
  });

  it("accepts only bounded image data URLs", () => {
    expect(parseWallpaper(IMAGE)).toEqual(IMAGE);
    expect(parseWallpaper({ ...IMAGE, data: "javascript:alert(1)" })).toBeNull();
    expect(parseWallpaper({ ...IMAGE, data: "data:image/svg+xml;base64,QUJD" })).toBeNull();
    expect(parseWallpaper({ ...IMAGE, data: `data:image/jpeg;base64,${"A".repeat(WALLPAPER_MAX_CHARS)}` })).toBeNull();
    expect(parseWallpaper({ ...IMAGE, width: 0 })).toBeNull();
    expect(parseWallpaper(null)).toBeNull();
  });
});
