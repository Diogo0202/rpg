import { useContext, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { portraitDataBytes } from "../../../../shared/portrait-data.ts";
import { accessTokenProvider, getSupabaseAuth } from "./auth";
import { NexusContext } from "./context";

const BUCKET = "character-portraits";
const EDGE = 512;
const signedSeconds = 900;

export async function preparePortrait(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Envie uma foto em JPG, PNG ou WebP.");
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("Escolha uma foto de até 10 MB.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Não foi possível abrir a foto."); });
  try {
    const canvas = document.createElement("canvas");
    canvas.width = EDGE;
    canvas.height = EDGE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O aparelho não conseguiu preparar a foto.");
    const size = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, EDGE, EDGE);
    for (const quality of [0.85, 0.65, 0.45]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (portraitDataBytes(data)) return data;
    }
    throw new Error("O aparelho não conseguiu gerar uma foto WebP de até 256 KB.");
  } finally {
    bitmap.close();
  }
}

export async function uploadSheetPortrait(
  auth: SupabaseClient | null, accountId: string, campaignId: string, data: unknown,
): Promise<string> {
  const bytes = portraitDataBytes(data);
  if (!bytes) throw new Error("A foto da ficha é inválida.");
  if (!auth || !await accessTokenProvider(auth, accountId)()) throw new Error("Entre na campanha para enviar a foto.");
  const path = [campaignId, accountId, crypto.randomUUID() + ".webp"].join("/");
  const { error } = await auth.storage.from(BUCKET).upload(path, new Blob([bytes], { type: "image/webp" }), {
    contentType: "image/webp", upsert: false,
  });
  if (error) throw new Error("Não foi possível enviar a foto. Confira a conexão e o acesso à campanha.");
  return path;
}

type PortraitFields = { portrait_data?: string | null; portrait_path?: string | null };

export function useSheetPortrait(data: PortraitFields | null | undefined): string | null {
  const context = useContext(NexusContext);
  const accountId = context?.user?.id;
  const campaignId = context?.campaignId;
  const path = data?.portrait_data === undefined && context?.mode === "connected" && campaignId && data?.portrait_path?.startsWith(campaignId + "/") ? data.portrait_path : null;
  const [signed, setSigned] = useState<{ path: string; accountId: string; url: string } | null>(null);
  useEffect(() => {
    if (!path || !accountId) return;
    const auth = getSupabaseAuth();
    if (!auth) return;
    let active = true;
    async function resolve() {
      try {
        if (!auth || !await accessTokenProvider(auth, accountId!)()) return;
        const { data: result } = await auth.storage.from(BUCKET).createSignedUrl(path!, signedSeconds);
        if (active) setSigned(result?.signedUrl ? { path: path!, accountId: accountId!, url: result.signedUrl } : null);
      } catch {
        if (active) setSigned(null);
      }
    }
    void resolve();
    const interval = setInterval(resolve, (signedSeconds - 60) * 1000);
    return () => { active = false; clearInterval(interval); };
  }, [path, accountId]);
  if (data?.portrait_data !== undefined) return data.portrait_data;
  return path && signed?.path === path && signed.accountId === accountId ? signed.url : null;
}
