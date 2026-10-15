import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CampaignWorkbench } from "../../../../components/campaign-workbench";
import { createClient, isSupabaseConfigured } from "../../../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Mesa | RPG Nexus",
  robots: { index: false, follow: false },
};

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  if (authError || !userData.user) redirect("/login");
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("id, name, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !campaign) notFound();
  const isOwner = campaign.owner_id === userData.user.id;
  const { data: membership } = isOwner ? { data: null } : await supabase
    .from("campaign_members")
    .select("role")
    .eq("campaign_id", id)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  const canManageTemplates = isOwner || membership?.role === "master";
  const canEditSheets = canManageTemplates || membership?.role === "player";

  return <>
    <div className="campaign-return"><Link href="/app">← Todas as campanhas</Link></div>
    <CampaignWorkbench campaignId={campaign.id} campaignName={campaign.name} viewerId={userData.user.id} isOwner={isOwner} canManageTemplates={canManageTemplates} canEditSheets={canEditSheets} />
  </>;
}
