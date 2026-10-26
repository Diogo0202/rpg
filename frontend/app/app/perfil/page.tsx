import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "../../../components/profile-form";
import styles from "../../../components/campaign-members-panel.module.css";
import { createClient, isSupabaseConfigured } from "../../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Perfil | RPG-Atlas",
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userData.user.id)
    .maybeSingle();

  return (
    <>
      <div className="campaign-return"><Link href="/app">← Todas as campanhas</Link></div>
      <main className={styles.page}>
        <ProfileForm displayName={profile?.display_name ?? ""} email={userData.user.email ?? null} />
      </main>
    </>
  );
}
