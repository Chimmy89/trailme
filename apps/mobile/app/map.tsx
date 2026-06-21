import Mapbox, { Camera, MapView } from '@rnmapbox/maps';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TIME_WINDOWS, type TimeWindow } from '@trailme/shared';

// Native Mapbox needs its access token set once, before any MapView mounts.
// (Web/GL-JS reads the token per-component; native reads it from this global.)
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

/**
 * Live map (M0 shell).
 *
 * Renders the base Mapbox map + the shared time-window selector. The trail /
 * heatmap / peer-marker layers from @trailme/map-style are wired in M3–M4 once
 * the realtime + trail_window paths exist. The mobile renderer is deliberately
 * capped tighter than the dashboard: SAME-SITE peers only, shorter default
 * window, bounded concurrent line layers (see ARCHITECTURE.md mobile-render
 * cap). No peer data is fetched yet.
 */
export default function MapScreen() {
  // 15 min is the mobile-friendly default (shorter than the dashboard).
  const [windowMin, setWindowMin] = useState<TimeWindow>(15);

  return (
    <View style={styles.container}>
      <MapView style={styles.map} styleURL={Mapbox.StyleURL.Dark}>
        <Camera
          zoomLevel={14}
          // Oslo placeholder until we center on the guard's own position (M2).
          centerCoordinate={[10.7522, 59.9139]}
        />
        {/*
          M3/M4: <ShapeSource> + <LineLayer>/<HeatmapLayer> whose paint/layout
          come from @trailme/map-style (trailLineLayer / coverageHeatmapLayer /
          liveMarkerCircleLayer), one source per same-site peer, window-trimmed
          client-side off `windowMin`. Intentionally unwired in M0 — no peer
          data and the GL-spec→rnmapbox flattening is M4 work.
        */}
      </MapView>

      <View style={styles.windowBar}>
        <Text style={styles.windowLabel}>Window</Text>
        <View style={styles.windowOptions}>
          {TIME_WINDOWS.map((min) => {
            const active = min === windowMin;
            return (
              <Pressable
                key={min}
                onPress={() => setWindowMin(min)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {min}m
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.actions}>
        <Link href="/shift" asChild>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionText}>Shift</Text>
          </Pressable>
        </Link>
        <Link href="/checkpoint" asChild>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionText}>Checkpoint</Text>
          </Pressable>
        </Link>
        <Link href="/tracking-health" asChild>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionText}>Tracking</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  windowBar: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(17,24,39,0.85)',
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  windowLabel: {
    color: '#9ca3af',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  windowOptions: { flexDirection: 'row', gap: 6 },
  chip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
  },
  chipActive: { backgroundColor: '#1d4ed8' },
  chipText: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  actions: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.9)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
