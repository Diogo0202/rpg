import { createClient } from "./supabase/client";
import { PORTRAIT_BUCKET, PORTRAIT_MAX_STORED_BYTES, PORTRAIT_SIZE, portraitObjectPath, squareCrop, validatePortraitFile } from "./portraits";

/**
 * Re-encodes the photo as a 512×512 WebP on a canvas. Re-encoding drops EXIF
 * metadata such as GPS location before anything leaves the device.
 */
export async function preparePortrait(file: File): Promise<Blob> {
  const problem = validatePortraitFile(file);
  if (problem) throw new Error(problem);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error("Não foi possível abrir esta imagem. Tente outra foto."); }
  const { sx, sy, size } = squareCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PORTRAIT_SIZE;
  canvas.height = PORTRAIT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Seu navegador não permitiu preparar a foto.");
  context.drawImage(bitmap, sx, sy, size, size, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob || blob.type !== "image/webp") throw new Error("Seu navegador não gerou a foto em WebP. Tente outro navegador.");
  if (blob.size > PORTRAIT_MAX_STORED_BYTES) throw new Error("A foto preparada passou de 2 MB. Tente uma imagem mais simples.");
  return blob;
}

/** Uploads into the uploader's own campaign folder and returns the object path. */
export async function uploadPortrait(campaignId: string, uploaderId: string, file: File): Promise<string> {
  const blob = await preparePortrait(file);
  const path = portraitObjectPath(campaignId, uploaderId, crypto.randomUUID());
  const { error } = await createClient().storage.from(PORTRAIT_BUCKET).upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw new Error("Não foi possível enviar a foto. Confira se você participa desta campanha.");
  return path;
}

const SIGNED_SECONDS = 3600;
const cache = new Map<string, { url: string; expires: number }>();

/** Signed URLs are cached for 50 of their 60 minutes. */
export async function portraitUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now();
  const result: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of new Set(paths)) {
    const hit = cache.get(path);
    if (hit && hit.expires > now) result[path] = hit.url;
    else missing.push(path);
  }
  if (missing.length) {
    const { data } = await createClient().storage.from(PORTRAIT_BUCKET).createSignedUrls(missing, SIGNED_SECONDS);
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) {
        cache.set(item.path, { url: item.signedUrl, expires: now + 50 * 60_000 });
        result[item.path] = item.signedUrl;
      }
    }
  }
  return result;
}
