import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@trailme/shared";
import { MapShell } from "@/map/MapShell";

/**
 * Live control-room map. Requires an authenticated session and reads the user's
 * tenant + role from the session JWT `app_metadata` (stamped server-side by the
 * Custom Access Token Hook). The interactive map is a client component; this
 * server boundary enforces auth and resolves the org name.
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

  let orgName: string | null = null;
  if (orgId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    orgName = org?.name ?? null;
  }

  return (
    <MapShell
      orgId={orgId}
      orgName={orgName}
      role={role}
      email={user.email}
    />
  );
}
