/**
 * Device-local wallpapers. They never sync: the images live in the local
 * prefs IndexedDB as JPEG data URLs.
 *
 * - "home": general wallpaper for the Mesa and Fichas start screens.
 * - "table": photo of the open campaign, shown on the Mesa screen.
 * - "sheet": character image, shown inside that sheet.
 */
import { useEffect, useState } from "react";
import { importMapImage } from "../../../frontend/lib/map-raster";
import { prefGet, prefSet } from "@/lib/nexus/prefs";

export type WallpaperSlot =
  | { kind: "home" }
  | { kind: "table"; campaignId: string }
  | { kind: "sheet"; campaignId: string; sheetId: string };

export type WallpaperImage = { data: string; name: string; width: number; height: number };

/** Upper bound for one stored image (characters of the data URL). */
export const WALLPAPER_MAX_CHARS = 1_500_000;
const PREFIX = "wallpaper-v1:";
const CHANGE_EVENT = "rpg-atlas-wallpaper-change";
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function wallpaperKey(slot: WallpaperSlot): string {
  if (slot.kind === "home") return `${PREFIX}home`;
  if (slot.kind === "table") return `${PREFIX}table:${slot.campaignId}`;
  return `${PREFIX}sheet:${slot.campaignId}:${slot.sheetId}`;
}

export function parseWallpaper(value: unknown): WallpaperImage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.data !== "string" || item.data.length > WALLPAPER_MAX_CHARS || !DATA_URL.test(item.data)) return null;
  const width = Number(item.width), height = Number(item.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  return { data: item.data, width, height, name: typeof item.name === "string" ? item.name.slice(0, 160) : "" };
}

/**
 * Which slot paints the background of a screen.
 * Start screens use the general wallpaper; the Mesa prefers the table photo;
 * an open sheet shows only its own character image.
 */
export function wallpaperSlotsFor(path: string, campaignId: string, sheetId?: string): WallpaperSlot[] {
  if (path === "/") return [{ kind: "table", campaignId }, { kind: "home" }];
  if (path === "/fichas" || path === "/fichas/") return sheetId ? [{ kind: "sheet", campaignId, sheetId }] : [{ kind: "home" }];
  return [];
}

export async function readWallpaper(slot: WallpaperSlot): Promise<WallpaperImage | null> {
  try { return parseWallpaper(await prefGet(wallpaperKey(slot))); }
  catch { return null; }
}

async function writeWallpaper(slot: WallpaperSlot, value: WallpaperImage | null): Promise<void> {
  await prefSet(wallpaperKey(slot), value);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: wallpaperKey(slot) }));
}

export async function importWallpaper(slot: WallpaperSlot, file: File): Promise<WallpaperImage> {
  const picture = await importMapImage(file, WALLPAPER_MAX_CHARS);
  const image = parseWallpaper(picture);
  if (!image) throw new Error("A imagem ficou fora do formato aceito.");
  await writeWallpaper(slot, image);
  return image;
}

export function removeWallpaper(slot: WallpaperSlot): Promise<void> {
  return writeWallpaper(slot, null);
}

/** First stored image among `slots`, refreshed whenever settings change one. */
export function useWallpaper(slots: WallpaperSlot[]): WallpaperImage | null {
  const keys = slots.map(wallpaperKey).join("|");
  const [image, setImage] = useState<WallpaperImage | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      for (const slot of slots) {
        const found = await readWallpaper(slot);
        if (found) { if (live) setImage(found); return; }
      }
      if (live) setImage(null);
    };
    void load();
    const onChange = (event: Event) => {
      const key = (event as CustomEvent<string>).detail;
      if (keys.split("|").includes(key)) void load();
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { live = false; window.removeEventListener(CHANGE_EVENT, onChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return image;
}
