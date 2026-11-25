export const PORTRAIT_DATA_MAX_BYTES = 256 * 1024;
const PREFIX = "data:image/webp;base64,";

export function portraitDataBytes(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX)
      || value.length > PREFIX.length + Math.ceil(PORTRAIT_DATA_MAX_BYTES / 3) * 4) return null;
  const encoded = value.slice(PREFIX.length);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  let binary: string;
  try { binary = atob(encoded); }
  catch { return null; }
  if (binary.length < 20 || binary.length > PORTRAIT_DATA_MAX_BYTES
      || binary.slice(0, 4) !== "RIFF" || binary.slice(8, 12) !== "WEBP"
      || !["VP8 ", "VP8L", "VP8X"].includes(binary.slice(12, 16))) return null;
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (new DataView(bytes.buffer).getUint32(4, true) !== bytes.length - 8) return null;
  return bytes;
}
