"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server";

export type CreateCampaignState = { error: string | null };

export async function createCampaign(
  _previous: CreateCampaignState,
  formData: FormData,
): Promise<CreateCampaignState> {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (name.length < 3 || name.length > 120) return { error: "O nome precisa ter entre 3 e 120 caracteres." };
  if (description.length > 2000) return { error: "A descrição aceita até 2.000 caracteres." };

  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");

  const { data, error } = await supabase
    .from("campaigns")
    .insert({ owner_id: userData.user.id, name, description })
    .select("id")
    .single();

  if (error || !data) return { error: "Não foi possível criar a campanha. Confira a conexão e as migrações do Supabase." };
  revalidatePath("/app");
  redirect(`/app/campaign/${data.id}`);
}
