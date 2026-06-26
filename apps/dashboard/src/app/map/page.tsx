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

  // org_id / role are injected into the JWT by the Custom Access Token Hook, so
  // they live in the token CLAIMS — NOT in the DB-stored app_metadata that
  // getUser() returns (which only carries provider/providers). Reading them off
  // getUser() yields null, so the org poll silently never runs and no peers show.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const claimMeta = jwtAppMetadata(session?.access_token);
  const orgId = (claimMeta.org_id as string | undefined) ?? null;
  const role = (claimMeta.role as Role | undefined) ?? null;

  let orgName: string | null = null;
  // Live channels this viewer subscribes to: a control room (org_admin/supervisor)
  // gets every org site; a guard gets only the sites they're assigned to (the
  // channel RLS rejects the rest anyway, but we don't even attempt them).
  let subscribeSites: { id: string; name: string }[] = [];
  if (orgId) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();
    orgName = org?.name ?? null;

    if (role === "org_admin" || role === "supervisor") {
      const { data } = await supabase.from("sites").select("id,name").eq("org_id", orgId);
      subscribeSites = data ?? [];
    } else {
      const siteIds = (claimMeta.site_ids as string[] | undefined) ?? [];
      if (siteIds.length > 0) {
        const { data } = await supabase
          .from("sites")
          .select("id,name")
          .eq("org_id", orgId)
          .in("id", siteIds);
        subscribeSites = data ?? [];
      }
    }
  }

  return (
    <MapShell
      orgId={orgId}
      orgName={orgName}
      role={role}
      email={user.email}
      subscribeSites={subscribeSites}
    />
  );
}

/**
 * Decode the `app_metadata` object from a Supabase access-token JWT payload —
 * where the Custom Access Token Hook stamps org_id/role/site_ids. Returns {} if
 * the token is missing or malformed (the page then renders the not-linked state).
 */
function jwtAppMetadata(token?: string): Record<string, unknown> {
  if (!token) return {};
  const payload = token.split(".")[1];
  if (!payload) return {};
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      app_metadata?: Record<string, unknown>;
    };
    return decoded.app_metadata ?? {};
  } catch {
    return {};
  }
}
