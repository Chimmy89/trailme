import { createClient } from "@/lib/supabase/server";

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 500,
};
const td: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid var(--border)",
};

/** Org roster: memberships joined with profile display names. */
export default async function RosterPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = (user?.app_metadata?.org_id as string | undefined) ?? null;

  const { data: members } = orgId
    ? await supabase
        .from("memberships")
        .select("user_id, role, site_ids, active")
        .eq("org_id", orgId)
    : { data: null };

  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] };

  const nameOf = (id: string) =>
    profiles?.find((p) => p.id === id)?.display_name ?? `${id.slice(0, 8)}…`;

  return (
    <section>
      <h1>Roster</h1>
      {members && members.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "1.5rem 0" }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Role</th>
              <th style={th}>Sites</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_id}>
                <td style={td}>{nameOf(m.user_id)}</td>
                <td style={td}>{m.role}</td>
                <td style={td}>
                  {m.role === "guard" ? `${m.site_ids?.length ?? 0} site(s)` : "all sites"}
                </td>
                <td style={td}>{m.active ? "active" : "inactive"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: "var(--muted)" }}>No members yet.</p>
      )}
      <p style={{ color: "var(--muted)", maxWidth: "44rem" }}>
        Inviting guards (join codes) and live presence — who is online plus tracking health — land
        in M5.
      </p>
    </section>
  );
}
