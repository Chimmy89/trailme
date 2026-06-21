import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * Prominent-disclosure consent screen.
 *
 * This MUST be shown BEFORE the OS location-permission prompt. It is both:
 *   - a GDPR transparency requirement (the guard must be told WHAT is collected,
 *     WHY, and on what lawful basis before any tracking starts), and
 *   - a Google Play store-approval requirement for background location
 *     (prominent disclosure + a Permissions Declaration).
 *
 * The "I understand" action (wired by the route) writes a guard_disclosures row
 * (notice_version, tracking_mode_at_accept, accepted_at) so the org can prove
 * exactly what each guard was told, THEN triggers the OS permission prompt.
 * Copy will be finalized from store-review feedback.
 *
 * Lawful basis is legitimate interest (Art. 6(1)(f)) — NOT employee consent,
 * which is generally not freely given under EDPB guidance. This screen informs;
 * it is not a consent gate that an employer leans on as the legal basis.
 */
export function Disclosure({
  onAcknowledge,
  busy = false,
  error,
}: {
  /** Records the acknowledgement, then prompts for OS permission. */
  onAcknowledge?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Before we start tracking</Text>

      <Text style={styles.lead}>
        TrailMe shares your live location with your team while you’re on shift so guards don’t
        re-cover the same ground — and so someone always knows where you are if you need help.
      </Text>

      <Section title="What we collect">
        Your GPS position and movement while you are clocked in, including with the screen off. On
        iOS you’ll see a blue indicator; on Android a persistent notification — these stay visible
        whenever tracking is on.
      </Section>

      <Section title="Why">
        Live team coordination (avoid duplicate coverage), an after-the-fact record of patrol
        coverage, and lone-worker safety.
      </Section>

      <Section title="When">
        {`Only between clock-in and clock-out (shift-gated mode). Your organization may enable always-on tracking; if so, you’ll be told here.`}
      </Section>

      <Section title="Your rights">
        Your data is retained for a limited period and you can request a copy or deletion. The legal
        basis is your employer’s legitimate interest in guard safety and coordination — full details
        are in the privacy notice.
      </Section>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.cta, (busy || !onAcknowledge) && styles.ctaDisabled]}
        disabled={busy || !onAcknowledge}
        onPress={onAcknowledge}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.ctaText}>I understand — continue</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' },
  lead: { fontSize: 16, lineHeight: 22, color: '#111827' },
  section: { gap: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#1d4ed8' },
  sectionBody: { fontSize: 14, lineHeight: 20, color: '#374151' },
  error: { color: '#dc2626', fontSize: 14 },
  cta: {
    marginTop: 8,
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaDisabled: { backgroundColor: '#9ca3af' },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
