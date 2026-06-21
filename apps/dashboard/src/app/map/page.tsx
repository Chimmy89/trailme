import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@trailme/shared";
import { MapShell } from "@/map/MapShell";

/**
 * Live control-room map. Requires an authenticated session and reads the user's
 * tenant + role from the session JWT `app_metadata` (stamped server-side by the
 * Custom Access Token Hook — see ARCHITECTURE.md M0). The interactive map itself
 * is a client component; this server boundary only enforces auth and hands the
 * verified identity context down.
 */
export default async function MapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const appMetadata = user.app_metadata ?? {};
  const orgId = (appMetadata.org_id as string | undefined) ?? null;
  const role = (appMetadata.role as Role | undefined) ?? null;
  const siteIds = (appMetadata.site_ids as string[] | undefined) ?? [];

  return (
    <MapShell orgId={orgId} role={role} siteIds={siteIds} email={user.email} />
  );
}
