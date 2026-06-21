import { createClient } from "@/lib/supabase/server";

const muted: React.CSSProperties = { color: "var(--muted)", maxWidth: "44rem" };

/** Read-only org settings (editing + audit-logged writes land in M5). */
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = (user?.app_metadata?.org_id as string | undefined) ?? null;

  const { data: settings } = orgId
    ? await supabase
        .from("org_settings")
        .select("tracking_mode, retention_days, lawful_basis, dpia_completed_at")
        .eq("org_id", orgId)
        .maybeSingle()
    : { data: null };

  return (
    <section>
      <h1>Organization settings</h1>
      {settings ? (
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "12rem 1fr",
            rowGap: "0.5rem",
            maxWidth: "36rem",
            margin: "1.5rem 0",
          }}
        >
          <Row label="Tracking mode" value={settings.tracking_mode} />
          <Row label="Retention" value={`${settings.retention_days} days`} />
          <Row label="Lawful basis" value={settings.lawful_basis} />
          <Row
            label="DPIA completed"
            value={
              settings.dpia_completed_at
                ? new Date(settings.dpia_completed_at).toLocaleDateString()
                : "— (required before always_on)"
            }
          />
        </dl>
      ) : (
        <p style={muted}>No settings found for your organization.</p>
      )}
      <p style={muted}>
        Editing the tracking mode (<code>shift_gated</code> vs <code>always_on</code>) and
        retention window — with the DPIA gate and the append-only <code>audit_log</code> — lands
        in M5. Read-only for now.
      </p>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: "var(--muted)" }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
    </>
  );
}
