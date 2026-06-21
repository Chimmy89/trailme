export default function SettingsPage() {
  return (
    <section>
      <h1>Organization settings</h1>
      <p style={{ color: "var(--muted)", maxWidth: "44rem" }}>
        Configure the tracking mode (<code>shift_gated</code> vs{" "}
        <code>always_on</code>) and the data retention window (7, 30, or 90
        days). Enabling <code>always_on</code> is blocked until a DPIA is
        recorded, and every change here is privacy-material — it writes an
        append-only <code>audit_log</code> entry. Lands in M5.
      </p>
    </section>
  );
}
