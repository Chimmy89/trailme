import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useTracking } from '@/tracking/useTracking';

/**
 * Clock-in / clock-out + shift-gated tracking.
 *
 * Clock-in calls the `clock_in` RPC (idempotent, offline-reconcilable) for the
 * guard's assigned site, then starts the TrackingService; clock-out stops
 * tracking and calls `clock_out`. The server gate is window-based on
 * captured_at, so a late-syncing clock-in still reconciles buffered breadcrumbs.
 * The screen surfaces both the shift state and the live tracking status — a
 * silently-dead tracker is a P0 field failure for a coverage product.
 */
type Busy = 'in' | 'out' | null;

export default function ShiftScreen() {
  const { status, identity, error, start, stop } = useTracking();
  const [onShift, setOnShift] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);

  const siteId = identity?.siteIds[0] ?? null;
  const tracking = status === 'tracking';

  async function clockIn() {
    setRpcError(null);
    if (!siteId) {
      setRpcError('You are not assigned to a site. Ask your supervisor.');
      return;
    }
    setBusy('in');
    // Open the shift first (optimistic, idempotent), then start the engine.
    const { error: e } = await supabase.rpc('clock_in', { p_site: siteId });
    if (e) {
      setBusy(null);
      setRpcError(e.message);
      return;
    }
    await start();
    setOnShift(true);
    setBusy(null);
  }

  async function clockOut() {
    setRpcError(null);
    setBusy('out');
    // Stop the engine first so no fixes are recorded after intent to clock out,
    // then close the shift window server-side.
    await stop();
    const { error: e } = await supabase.rpc('clock_out', {});
    setBusy(null);
    if (e) {
      setRpcError(e.message);
      return;
    }
    setOnShift(false);
  }

  // The disclosure must be accepted before tracking can start; route there.
  if (error === 'disclosure_required') {
    return (
      <View style={styles.container}>
        <View style={[styles.banner, styles.bannerOff]}>
          <Text style={styles.bannerText}>BEFORE YOU START</Text>
          <Text style={styles.bannerSub}>
            You need to review how TrailMe uses your location before tracking can begin.
          </Text>
        </View>
        <Pressable
          style={[styles.button, styles.clockIn]}
          onPress={() => router.push('/disclosure')}
        >
          <Text style={styles.buttonText}>Review & continue</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.banner, onShift ? styles.bannerOn : styles.bannerOff]}>
        <Text style={styles.bannerText}>{onShift ? 'ON SHIFT' : 'OFF SHIFT'}</Text>
        <Text style={styles.bannerSub}>
          {onShift
            ? 'Your patrol is being recorded and shared with your team.'
            : 'Tracking is paused. Clock in to start your patrol.'}
        </Text>
      </View>

      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: tracking ? '#16a34a' : '#9ca3af' }]} />
        <Text style={styles.statusText}>Tracking: {tracking ? 'active' : status}</Text>
      </View>

      {rpcError ? <Text style={styles.error}>{rpcError}</Text> : null}
      {error && error !== 'disclosure_required' ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, onShift ? styles.clockOut : styles.clockIn]}
        disabled={busy !== null}
        onPress={onShift ? clockOut : clockIn}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{onShift ? 'Clock out' : 'Clock in'}</Text>
        )}
      </Pressable>
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  statusText: { fontSize: 15, color: '#374151', fontWeight: '600' },
  error: { color: '#dc2626', textAlign: 'center', fontSize: 14 },
  button: { borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  clockIn: { backgroundColor: '#1d4ed8' },
  clockOut: { backgroundColor: '#b91c1c' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
});
