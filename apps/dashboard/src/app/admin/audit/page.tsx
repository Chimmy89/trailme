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
  verticalAlign: "top",
};

/** Append-only accountability log (most recent first). */
export default async function AuditPage() {
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("audit_log")
    .select("*")
    .order("ts", { ascending: false })
    .limit(50);

  return (
    <section>
      <h1>Audit log</h1>
      {events && events.length ? (
        <table style={{ width: "100%", borderCollapse: "collapse", margin: "1.5rem 0" }}>
          <thead>
            <tr>
              <th style={th}>When</th>
              <th style={th}>Action</th>
              <th style={th}>Actor</th>
              <th style={th}>Target</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={td}>{new Date(e.ts).toLocaleString()}</td>
                <td style={td}>{e.action}</td>
                <td style={td}>{e.actor_user_id ? `${e.actor_user_id.slice(0, 8)}…` : "—"}</td>
                <td style={td}>{e.target_guard_id ? `${e.target_guard_id.slice(0, 8)}…` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: "var(--muted)", maxWidth: "44rem" }}>
          No audit events yet. Reading a guard&apos;s trail (<code>trail_window</code>), changing
          settings, or a DSAR/erasure each writes an append-only entry here.
        </p>
      )}
    </section>
  );
}
