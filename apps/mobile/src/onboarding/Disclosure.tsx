import { ScrollView, StyleSheet, Text, View } from 'react-native';

/**
 * Prominent-disclosure consent screen (M0 shell).
 *
 * This MUST be shown BEFORE the OS location-permission prompt. It is both:
 *   - a GDPR transparency requirement (the guard must be told WHAT is collected,
 *     WHY, and on what lawful basis before any tracking starts), and
 *   - a Google Play store-approval requirement for background location
 *     (prominent disclosure + a Permissions Declaration).
 *
 * In M2 the "I understand" action writes a guard_disclosures row
 * (notice_version, tracking_mode_at_accept, accepted_at) so the org can prove
 * exactly what each guard was told, THEN triggers the OS permission prompt.
 * Copy below is placeholder and will be finalized from store-review feedback.
 *
 * Lawful basis is legitimate interest (Art. 6(1)(f)) — NOT employee consent,
 * which is generally not freely given under EDPB guidance. This screen informs;
 * it is not a consent gate that an employer leans on as the legal basis.
 */
export function Disclosure({
  onAcknowledge,
}: {
  /** Wired in M2: records the acknowledgement, then prompts for OS permission. */
  onAcknowledge?: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Before we start tracking</Text>

      <Text style={styles.lead}>
        TrailMe shares your live location with your team while you’re on shift so
        guards don’t re-cover the same ground — and so someone always knows where
        you are if you need help.
      </Text>

      <Section title="What we collect">
        Your GPS position and movement while you are clocked in, including with
        the screen off. On iOS you’ll see a blue indicator; on Android a
        persistent notification — these stay visible whenever tracking is on.
      </Section>

      <Section title="Why">
        Live team coordination (avoid duplicate coverage), an after-the-fact
        record of patrol coverage, and lone-worker safety.
      </Section>

      <Section title="When">
        {`Only between clock-in and clock-out (shift-gated mode). Your organization may enable always-on tracking; if so, you’ll be told here.`}
      </Section>

      <Section title="Your rights">
        Your data is retained for a limited period and you can request a copy or
        deletion. The legal basis is your employer’s legitimate interest in guard
        safety and coordination — full details are in the privacy notice.
      </Section>

      <View style={styles.placeholderCta}>
        <Text style={styles.placeholderText}>
          [M2] “I understand” button → records guard_disclosures → triggers the
          OS location prompt.
        </Text>
        {onAcknowledge ? (
          <Text style={styles.placeholderText}>onAcknowledge handler ready.</Text>
        ) : null}
      </View>
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
  placeholderCta: {
    marginTop: 8,
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    gap: 4,
  },
  placeholderText: { color: '#6b7280', fontSize: 13, fontStyle: 'italic' },
});
