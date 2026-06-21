import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { trackingService, type TrackingStatus } from '@/tracking/TrackingService';
import { isIgnoringBatteryOptimizations, openBatteryExemptionSettings } from '@/tracking/battery';

/**
 * Tracking-health screen.
 *
 * Surfaces the current tracking status, the battery-optimization exemption
 * state, and a one-tap deep-link to the OEM battery screen. For a coverage
 * product a SILENTLY-dead tracker is a P0 field failure, so this screen (plus
 * the M6 server-side staleness watchdog) is how a guard sees tracking is degraded.
 */
const STATUS_COPY: Record<TrackingStatus, { label: string; tone: string }> = {
  stopped: { label: 'Stopped', tone: '#6b7280' },
  starting: { label: 'Starting…', tone: '#d97706' },
  tracking: { label: 'Tracking', tone: '#16a34a' },
  denied: { label: 'Permission denied', tone: '#b91c1c' },
  error: { label: 'Error', tone: '#b91c1c' },
};

export default function TrackingHealthScreen() {
  const [status, setStatus] = useState<TrackingStatus>(trackingService.getStatus());
  const [exempt, setExempt] = useState<boolean | null>(null);

  useEffect(() => {
    return trackingService.onStatusChange(setStatus);
  }, []);

  useEffect(() => {
    void isIgnoringBatteryOptimizations().then(setExempt);
  }, []);

  const copy = STATUS_COPY[status];

  async function openBattery() {
    await openBatteryExemptionSettings();
    // Re-check after returning; the user may have toggled the exemption.
    setExempt(await isIgnoringBatteryOptimizations());
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Tracking status</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: copy.tone }]} />
          <Text style={[styles.statusText, { color: copy.tone }]}>{copy.label}</Text>
        </View>
        {status === 'denied' ? (
          <Text style={styles.cardNote}>
            Location permission is off. Enable “Always” location for TrailMe in Settings, then clock
            in again.
          </Text>
        ) : null}
      </View>

      <View style={styles.hint}>
        <Text style={styles.hintTitle}>Keep tracking alive</Text>
        {Platform.OS === 'android' ? (
          <>
            <Text style={styles.hintBody}>
              Some phones (Samsung, Xiaomi, Huawei, Oppo/Vivo) aggressively stop background apps to
              save battery. Exempt TrailMe from battery optimization and lock it in your recent-apps
              tray so your patrol is never missed.
            </Text>
            <View style={styles.exemptRow}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: exempt === null ? '#9ca3af' : exempt ? '#16a34a' : '#b91c1c',
                  },
                ]}
              />
              <Text style={styles.exemptText}>
                {exempt === null
                  ? 'Checking battery exemption…'
                  : exempt
                    ? 'Battery optimization is exempt — good.'
                    : 'Battery optimization is ON — tracking may be killed.'}
              </Text>
            </View>
            <Pressable style={styles.button} onPress={openBattery}>
              <Text style={styles.buttonText}>Open battery settings</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.hintBody}>
            On iOS, keep Location set to “Always” and leave the blue location indicator on while on
            patrol — that’s how your team sees your live position.
          </Text>
        )}
      </View>

      <Text style={styles.note}>
        Status reflects the local TrackingService. The server-side “went dark” watchdog lands in M6.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 16 },
  card: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  cardLabel: {
    color: '#6b7280',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardNote: { color: '#6b7280', fontSize: 13, lineHeight: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { fontSize: 20, fontWeight: '700' },
  hint: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  hintTitle: { fontSize: 16, fontWeight: '700', color: '#92400e' },
  hintBody: { fontSize: 14, lineHeight: 20, color: '#78350f' },
  exemptRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exemptText: { fontSize: 13, color: '#78350f', flex: 1 },
  button: {
    backgroundColor: '#b45309',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  note: { color: '#9ca3af', fontSize: 13, lineHeight: 18 },
});
