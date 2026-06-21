export default function AuditPage() {
  return (
    <section>
      <h1>Audit log</h1>
      <p style={{ color: "var(--muted)", maxWidth: "44rem" }}>
        Read-only viewer over the append-only <code>audit_log</code>: who read
        which guard&apos;s trail (<code>trail_window</code>), every DSAR export,
        every erasure, and every privacy-material settings change. This is a
        GDPR Art. 5(2) accountability record — present from M1, never
        backfilled. Viewer lands in M5.
      </p>
    </section>
  );
}
