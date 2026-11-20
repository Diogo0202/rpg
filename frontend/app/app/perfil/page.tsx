import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ProfileForm } from "../../../components/profile-form";
import styles from "../../../components/campaign-members-panel.module.css";
import { createClient, isSupabaseConfigured } from "../../../lib/supabase/server";
import { profileName } from "../../../lib/data/campaign";

export const metadata: Metadata = {
  title: "Perfil | RPG-Atlas",
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) redirect("/login");
  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");
  const { data: profile } = await profileName(supabase, userData.user.id);

  return (
    <>
      <div className="campaign-return"><Link href="/app">← Todas as campanhas</Link></div>
      <main className={styles.page}>
        <ProfileForm displayName={profile?.display_name ?? ""} email={userData.user.email ?? null} />
      </main>
    </>
  );
}
