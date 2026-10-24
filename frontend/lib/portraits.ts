/**
 * Character portraits: pure rules shared by the upload flow and the tests.
 * Objects live in the private `character-portraits` bucket at
 * {campaign_id}/{uploader_id}/{uuid}.webp (see the 20261023100000 migration).
 */
export const PORTRAIT_BUCKET = "character-portraits";
export const PORTRAIT_MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const PORTRAIT_MAX_STORED_BYTES = 2 * 1024 * 1024;
export const PORTRAIT_SIZE = 512;
export const PORTRAIT_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH = new RegExp(`^(${UUID})/(${UUID})/${UUID}\\.webp$`);

/** Returns a message for files the browser should not even try to process. */
export function validatePortraitFile(file: { type: string; size: number }): string {
  if (!PORTRAIT_INPUT_TYPES.includes(file.type)) return "Envie uma foto em JPG, PNG ou WebP.";
  if (file.size <= 0) return "O arquivo da foto está vazio.";
  if (file.size > PORTRAIT_MAX_INPUT_BYTES) return "A foto original deve ter até 10 MB.";
  return "";
}

export function portraitObjectPath(campaignId: string, uploaderId: string, objectId: string): string {
  return `${campaignId}/${uploaderId}/${objectId}.webp`;
}

export function parsePortraitPath(path: string): { campaignId: string; uploaderId: string } | null {
  const match = PATH.exec(path);
  return match ? { campaignId: match[1], uploaderId: match[2] } : null;
}

/** Centre square crop of a width×height image, as source rectangle. */
export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
