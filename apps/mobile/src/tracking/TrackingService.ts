/**
 * TrackingService — the swappable wrapper over the background-geolocation engine.
 *
 * This is the single seam between the rest of the app and whatever native
 * tracking engine is in use. NOTHING outside this folder imports
 * react-native-background-geolocation directly. That lets us:
 *   - swap transistorsoft for an expo-location fallback (or a future engine)
 *     without touching screens/state, and
 *   - keep the platform-specific reliability rules (publish-from-onLocation,
 *     monotonic captured_at, gated persist) in exactly one place.
 *
 * RESPONSIBILITIES (see ARCHITECTURE.md "Realtime architecture" + critiques):
 *
 *   1. LIVE PUBLISH FROM onLocation — never from a wall-clock background timer.
 *      iOS suspends the JS process + tears down the socket within seconds of
 *      backgrounding, so a 2–5s timer does NOT fire in the field. The engine's
 *      onLocation callback DOES wake the app in the background on both
 *      platforms; we publish the live tick from inside it. Background live
 *      cadence therefore equals movement cadence (distanceFilter), not a timer.
 *
 *   2. MONOTONIC captured_at — the device clock can jump (manual change, NTP
 *      correction, timezone change mid-shift). captured_at drives trail
 *      ordering, age-fade, AND the idempotency key, so it MUST be
 *      non-decreasing per device: captured_at = max(lastTs + 1ms, gpsTs).
 *
 *   3. GATED PERSIST — persist a breadcrumb on (>=5s elapsed) OR (>=10m moved),
 *      suppress stationary noise, emit a 2-min keepalive (is_keepalive) so a
 *      parked guard stays "alive" without creating a false heatmap hotspot.
 *      The durable POST/queue is owned by the engine's native HTTP sync,
 *      authed by the ~24h DEVICE token (NOT the 1h interactive session).
 *
 *   4. SHIFT GATE — in shift_gated mode, start/stop follows clock-in/out. The
 *      server is the authority (window-based on captured_at); the client just
 *      avoids burning battery/GPS when off-shift.
 *
 * M0 SCOPE: define the interface + a transistorsoft-backed SKELETON (wires
 * onLocation, no real ingest POST) + an expo-location fallback stub. The actual
 * ingest POST, device-token auth, and gated-persist wiring are M2 TODOs.
 */

import type { Breadcrumb } from '@trailme/shared';

/**
 * The durable wire shape posted by the native HTTP sync at ingest time. A
 * {@link TrackingLocation} is mapped to this (adding guardId + the monotonic
 * clientSeq) in the M2 gated-persist path. Re-exported so that path imports the
 * breadcrumb DTO from the tracking module, its natural home.
 */
export type { Breadcrumb };

/** What the rest of the app can observe about the tracker. */
export type TrackingStatus =
  | 'stopped'
  | 'starting'
  | 'tracking'
  | 'denied' // OS permission refused
  | 'error';

/** A single location update normalized away from any engine's native shape. */
export interface TrackingLocation {
  lat: number;
  lon: number;
  /** Device event time, ISO 8601. Made monotonic per device before emit. */
  capturedAt: string;
  /** Horizontal accuracy in metres; used to drop/flag low-confidence fixes. */
  accuracyM: number;
  /** True for a periodic "still alive" fix with no real movement. */
  isKeepalive: boolean;
}

export interface TrackingConfig {
  /** shift_gated only tracks between clock-in and clock-out. */
  mode: 'shift_gated' | 'always_on';
  /** Stable per-install device id used for the monotonic-seq + ingest token. */
  guardId: string;
  /** Engine distance gate (metres). Background live cadence ~= this. */
  distanceFilterM: number;
}

/** The seam every screen/store talks to. Engines implement this. */
export interface TrackingService {
  configure(config: TrackingConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): TrackingStatus;
  /** Subscribe to normalized location updates. Returns an unsubscribe fn. */
  onLocation(listener: (loc: TrackingLocation) => void): () => void;
  /** Subscribe to status changes. Returns an unsubscribe fn. */
  onStatusChange(listener: (status: TrackingStatus) => void): () => void;
}

/**
 * Shared monotonic-clock + gating helpers, engine-independent so every
 * implementation enforces the same captured_at integrity rules.
 */
class TrackingCore {
  private lastTsMs = 0;

  /** captured_at = max(lastTs + 1ms, gpsTs) — never goes backwards. */
  monotonicCapturedAt(gpsTimeMs: number): string {
    const next = Math.max(this.lastTsMs + 1, gpsTimeMs);
    this.lastTsMs = next;
    return new Date(next).toISOString();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// transistorsoft-backed implementation (SKELETON — ingest POST is an M2 TODO)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Production engine. Imports react-native-background-geolocation and wires its
 * onLocation callback to (a) make captured_at monotonic, (b) publish the live
 * tick, (c) hand the gated fix to the durable queue.
 *
 * NOTE: the import is intentionally `require`-style lazy via dynamic import in
 * start() so the rest of the app (and the expo-location fallback) doesn't pull
 * in the native module on platforms/builds where it isn't linked.
 */
export class TransistorTrackingService implements TrackingService {
  private core = new TrackingCore();
  private status: TrackingStatus = 'stopped';
  private config: TrackingConfig | null = null;
  private locationListeners = new Set<(loc: TrackingLocation) => void>();
  private statusListeners = new Set<(s: TrackingStatus) => void>();

  async configure(config: TrackingConfig): Promise<void> {
    this.config = config;
    // M2: BackgroundGeolocation.ready({
    //   distanceFilter: config.distanceFilterM,
    //   stopOnTerminate: false, startOnBoot: true,
    //   url: <ingest endpoint>, autoSync: true, batchSync: true,
    //   headers: { Authorization: `Bearer ${deviceToken}` }, // 24h device token
    //   foregroundService: true,                              // Android FGS
    //   ... heartbeatInterval for the 2-min keepalive, etc.
    // })
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error('TrackingService.start() before configure()');
    }
    this.setStatus('starting');

    // Lazy native import so non-native builds/fallback don't link it.
    // const BackgroundGeolocation = (
    //   await import('react-native-background-geolocation')
    // ).default;
    //
    // BackgroundGeolocation.onLocation((location) => {
    //   // (1) normalize + make captured_at monotonic
    //   const capturedAt = this.core.monotonicCapturedAt(
    //     new Date(location.timestamp).getTime(),
    //   );
    //   const loc: TrackingLocation = {
    //     lat: location.coords.latitude,
    //     lon: location.coords.longitude,
    //     capturedAt,
    //     accuracyM: location.coords.accuracy,
    //     isKeepalive: location.sample === true,
    //   };
    //   // (2) PUBLISH LIVE from the callback (not a timer) — advisory tick.
    //   //     TODO(M2): emit on the realtime socket opportunistically.
    //   // (3) DURABLE: the native HTTP sync owns the gated-persist POST,
    //   //     authed by the device token. TODO(M2): wire url + token + gate.
    //   this.emitLocation(loc);
    // });
    //
    // BackgroundGeolocation.start();

    this.setStatus('tracking');
  }

  async stop(): Promise<void> {
    // M2: BackgroundGeolocation.stop();
    this.setStatus('stopped');
  }

  getStatus(): TrackingStatus {
    return this.status;
  }

  onLocation(listener: (loc: TrackingLocation) => void): () => void {
    this.locationListeners.add(listener);
    return () => this.locationListeners.delete(listener);
  }

  onStatusChange(listener: (s: TrackingStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private emitLocation(loc: TrackingLocation): void {
    for (const l of this.locationListeners) l(loc);
  }

  private setStatus(status: TrackingStatus): void {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// expo-location fallback (STUB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emergency fallback when the native background engine is unavailable (e.g. a
 * build without the transistorsoft license, or an OEM that killed the FGS).
 * expo-location CANNOT match transistorsoft's screen-off reliability across OEM
 * battery killers — this exists only so the app degrades instead of dying, and
 * so tracking-health can tell the guard tracking is degraded.
 */
export class ExpoLocationTrackingService implements TrackingService {
  private status: TrackingStatus = 'stopped';
  private statusListeners = new Set<(s: TrackingStatus) => void>();

  async configure(_config: TrackingConfig): Promise<void> {
    // M2: no-op; expo-location is configured per-request at start().
  }

  async start(): Promise<void> {
    // M2: expo-location startLocationUpdatesAsync (foreground-biased).
    this.setStatus('tracking');
  }

  async stop(): Promise<void> {
    this.setStatus('stopped');
  }

  getStatus(): TrackingStatus {
    return this.status;
  }

  onLocation(_listener: (loc: TrackingLocation) => void): () => void {
    // M2: forward expo-location updates here.
    return () => {};
  }

  onStatusChange(listener: (s: TrackingStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: TrackingStatus): void {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }
}

/**
 * Single app-wide tracking service. Swapping engines is a one-line change here.
 * Defaults to the transistorsoft engine; the fallback is selected at runtime in
 * M2 when the native engine reports unavailable/unlicensed.
 */
export const trackingService: TrackingService = new TransistorTrackingService();
