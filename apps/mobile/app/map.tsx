import Mapbox, { Camera, CircleLayer, LineLayer, MapView, ShapeSource } from '@rnmapbox/maps';
import { Link } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  SOURCE_IDS,
  guardColor,
  liveMarkerCircleLayer,
  trailLineLayer,
  trailSourceId,
} from '@trailme/map-style';
import { TIME_WINDOWS, type TimeWindow } from '@trailme/shared';

import { usePeers, type Peer } from '@/map/usePeers';
import { toRNMapboxStyle } from '@/map/style-adapter';

// Native Mapbox needs its access token set once, before any MapView mounts.
// (Web/GL-JS reads the token per-component; native reads it from this global.)
Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '');

/**
 * Live map.
 *
 * Renders the base Mapbox map, same-site peer markers seeded from
 * `trail_window` and updated by the per-site live broadcast, and a basic
 * per-guard trail line. The mobile renderer is deliberately capped tighter than
 * the dashboard: SAME-SITE peers only, shorter default window, one line layer
 * per peer (see ARCHITECTURE.md mobile-render cap). The window selector re-runs
 * `trail_window`.
 */
export default function MapScreen() {
  // 15 min is the mobile-friendly default (shorter than the dashboard).
  const [windowMin, setWindowMin] = useState<TimeWindow>(15);
  const { peers, loading, error } = usePeers(windowMin);

  // One FeatureCollection of live markers; the shared circle layer reads color
  // and online from feature properties.
  const liveFeatures = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: peers.map((p) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
        properties: { color: guardColor(p.guardId), online: p.online },
      })),
    }),
    [peers],
  );

  const circleStyle = useMemo(() => toRNMapboxStyle(liveMarkerCircleLayer()), []);

  // Center on the first peer if present, else Oslo placeholder.
  const center = peers[0] ? [peers[0].lon, peers[0].lat] : [10.7522, 59.9139];

  return (
    <View style={styles.container}>
      <MapView style={styles.map} styleURL={Mapbox.StyleURL.Dark}>
        <Camera zoomLevel={14} centerCoordinate={center} />

        {/* Per-guard trail: one source + line layer per peer (line-gradient
            can't be filtered per-feature, so trails are not merged). */}
        {peers.map((p) => (
          <PeerTrail key={p.guardId} peer={p} />
        ))}

        {/* Live markers: one shared source + the shared circle layer. */}
        <ShapeSource id={SOURCE_IDS.LIVE_POSITIONS} shape={liveFeatures}>
          <CircleLayer id="trailme-live-marker-circle" style={circleStyle} />
        </ShapeSource>
      </MapView>

      <View style={styles.windowBar}>
        <View style={styles.windowHeader}>
          <Text style={styles.windowLabel}>Window</Text>
          {loading ? <ActivityIndicator size="small" color="#9ca3af" /> : null}
        </View>
        <View style={styles.windowOptions}>
          {TIME_WINDOWS.map((min) => {
            const active = min === windowMin;
            return (
              <Pressable
                key={min}
                onPress={() => setWindowMin(min)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{min}m</Text>
              </Pressable>
            );
          })}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
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

/** A single peer's trail as a LineString styled with the shared trail layer. */
function PeerTrail({ peer }: { peer: Peer }) {
  const color = guardColor(peer.guardId);
  const shape = useMemo(
    () => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        // newest-LAST so the line-gradient (line-progress) fades correctly.
        coordinates: peer.trail.map((pt) => [pt.lon, pt.lat]),
      },
    }),
    [peer.trail],
  );
  const lineStyle = useMemo(
    () => toRNMapboxStyle(trailLineLayer(peer.guardId, color)),
    [peer.guardId, color],
  );

  // A trail needs >= 2 points to draw a line.
  if (peer.trail.length < 2) return null;

  return (
    <ShapeSource id={trailSourceId(peer.guardId)} shape={shape} lineMetrics>
      <LineLayer id={`trailme-trail-line-${peer.guardId}`} style={lineStyle} />
    </ShapeSource>
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
  windowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  error: { color: '#fca5a5', fontSize: 12 },
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
