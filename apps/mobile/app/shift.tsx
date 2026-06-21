import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * Clock-in / clock-out shell (M0).
 *
 * No backend wiring yet. In M2 these buttons call the clock_in / clock_out
 * RPCs and drive TrackingService.start()/stop() (shift_gated mode), with an
 * optimistic, offline-cached clock-in so the SDK keeps recording even when the
 * RPC can't reach the server at shift start (basement parking garage). The
 * server gate is window-based on captured_at and reconciles a late clock-in.
 */
type ShiftState = 'off' | 'on';

export default function ShiftScreen() {
  const [state, setState] = useState<ShiftState>('off');
  const onShift = state === 'on';

  return (
    <View style={styles.container}>
      <View
        style={[styles.banner, onShift ? styles.bannerOn : styles.bannerOff]}
      >
        <Text style={styles.bannerText}>
          {onShift ? 'ON SHIFT' : 'OFF SHIFT'}
        </Text>
        <Text style={styles.bannerSub}>
          {onShift
            ? 'Your patrol is being recorded and shared with your team.'
            : 'Tracking is paused. Clock in to start your patrol.'}
        </Text>
      </View>

      <Pressable
        style={[styles.button, onShift ? styles.clockOut : styles.clockIn]}
        onPress={() => setState(onShift ? 'off' : 'on')}
      >
        <Text style={styles.buttonText}>
          {onShift ? 'Clock out' : 'Clock in'}
        </Text>
      </Pressable>

      <Text style={styles.note}>
        Backend wiring (clock-in/out RPCs, offline reconciliation, tracking
        start/stop) lands in M2. This screen only reflects local state for now.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 24, justifyContent: 'center' },
  banner: { borderRadius: 16, padding: 24, alignItems: 'center', gap: 8 },
  bannerOn: { backgroundColor: '#16a34a' },
  bannerOff: { backgroundColor: '#6b7280' },
  bannerText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 1,
  },
  bannerSub: { color: '#f3f4f6', fontSize: 14, textAlign: 'center' },
  button: { borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  clockIn: { backgroundColor: '#1d4ed8' },
  clockOut: { backgroundColor: '#b91c1c' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  note: { color: '#888', fontSize: 13, textAlign: 'center', lineHeight: 18 },
});
