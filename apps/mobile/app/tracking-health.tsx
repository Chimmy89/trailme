import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { trackingService, type TrackingStatus } from '@/tracking/TrackingService';

/**
 * Tracking-health screen (M0 shell).
 *
 * Surfaces the current tracking status + an OEM battery-exemption hint. For a
 * coverage product a SILENTLY-dead tracker is a P0 field failure, so this
 * screen (plus the M6 server-side staleness watchdog) is how a guard sees that
 * tracking is degraded. The OEM deep-links (requestIgnoreBatteryOptimizations,
 * per-OEM autostart/protected-apps screens) are wired in M2.
 */
const STATUS_COPY: Record<TrackingStatus, { label: string; tone: string }> = {
  stopped: { label: 'Stopped', tone: '#6b7280' },
  starting: { label: 'Starting…', tone: '#d97706' },
  tracking: { label: 'Tracking', tone: '#16a34a' },
  denied: { label: 'Permission denied', tone: '#b91c1c' },
  error: { label: 'Error', tone: '#b91c1c' },
};

export default function TrackingHealthScreen() {
  const [status, setStatus] = useState<TrackingStatus>(
    trackingService.getStatus(),
  );

  useEffect(() => {
    return trackingService.onStatusChange(setStatus);
  }, []);

  const copy = STATUS_COPY[status];

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Tracking status</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: copy.tone }]} />
          <Text style={[styles.statusText, { color: copy.tone }]}>
            {copy.label}
          </Text>
        </View>
      </View>

      <View style={styles.hint}>
        <Text style={styles.hintTitle}>Keep tracking alive</Text>
        {Platform.OS === 'android' ? (
          <Text style={styles.hintBody}>
            Some phones (Samsung, Xiaomi, Huawei, Oppo/Vivo) aggressively stop
            background apps to save battery. To make sure your patrol is never
            missed, exempt TrailMe from battery optimization and lock it in your
            recent-apps tray.{'\n\n'}
            We’ll deep-link you to the exact settings screen for your device in
            an upcoming release (M2). Until then, open Settings → Battery → and
            allow TrailMe to run in the background.
          </Text>
        ) : (
          <Text style={styles.hintBody}>
            On iOS, keep Location set to “Always” and leave the blue location
            indicator on while on patrol — that’s how your team sees your live
            position. The “Always” upgrade prompt is wired in M2.
          </Text>
        )}
      </View>

      <Text style={styles.note}>
        Status reflects the local TrackingService. Real background tracking +
        the server-side “went dark” watchdog land in M2 / M6.
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { fontSize: 20, fontWeight: '700' },
  hint: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  hintTitle: { fontSize: 16, fontWeight: '700', color: '#92400e' },
  hintBody: { fontSize: 14, lineHeight: 20, color: '#78350f' },
  note: { color: '#9ca3af', fontSize: 13, lineHeight: 18 },
});
