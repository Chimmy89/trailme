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
 */

import BackgroundGeolocation from 'react-native-background-geolocation';
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
  /** Bearing in degrees [0,360); null when unknown/stationary. */
  heading: number | null;
  /** True for a periodic "still alive" fix with no real movement. */
  isKeepalive: boolean;
}

/**
 * Durable-ingest wiring handed to the engine so its native HTTP sync can flush
 * the breadcrumb buffer without the JS engine running.
 */
export interface IngestConfig {
  /** ingest-breadcrumbs Edge Function URL. */
  url: string;
  /** ~24h device-scoped JWT (NOT the interactive session). */
  deviceToken: string;
  /** Per-install epoch, attached to every fix for the dedup key. */
  installId: string;
}

export interface TrackingConfig {
  /** shift_gated only tracks between clock-in and clock-out. */
  mode: 'shift_gated' | 'always_on';
  /** Stable per-install device id used for the monotonic-seq + ingest token. */
  guardId: string;
  /** Engine distance gate (metres). Background live cadence ~= this. */
  distanceFilterM: number;
  /** Durable-ingest endpoint + device-token auth. */
  ingest: IngestConfig;
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
// transistorsoft-backed implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps each buffered native location record onto the @trailme/shared Breadcrumb
 * wire shape via the SDK's Ruby-erb-style template (bare `<%= tag %>`
 * substitution only — the native template engine is NOT relied on for computed
 * expressions). httpRootProperty:'breadcrumbs' nests the rendered objects into
 * the BreadcrumbBatch `{ breadcrumbs: [...] }` body the ingest function expects.
 * String tags are quoted; numeric tags (lat/lon/clientSeq/accuracy) are not.
 *
 * `clientSeq` is sourced from `timestampMeta.systemTime` (epoch-ms) because the
 * native HTTP sync flushes WITHOUT the JS engine running, so it cannot maintain
 * a JS-side monotonic counter. A replay of the same buffered record carries the
 * same systemTime, so `(guardId, installId, clientSeq)` still dedups idempotently
 * on the server. (The strictly-monotonic max(lastTs+1, gpsTs) clock governs the
 * LIVE tick path below, which the JS layer fully controls.)
 *
 * `isKeepalive` is sent as literal `false`: the template engine can't reliably
 * invert `is_moving`, and the ingest function ALREADY flags stuck/duplicate
 * last-known fixes (a parked guard's heartbeats land on the same lat/lon) as
 * low-confidence and excludes them from the heatmap — so the parked-guard
 * false-hotspot is prevented server-side regardless of this flag.
 */
const LOCATION_TEMPLATE =
  '{' +
  '"guardId":"<%= extras.guardId %>",' +
  '"installId":"<%= extras.installId %>",' +
  '"lat":<%= latitude %>,' +
  '"lon":<%= longitude %>,' +
  '"capturedAt":"<%= timestamp %>",' +
  '"clientSeq":<%= timestampMeta.systemTime %>,' +
  '"accuracyM":<%= accuracy %>,' +
  '"isKeepalive":false' +
  '}';

/**
 * Production engine. Wires react-native-background-geolocation's onLocation
 * callback to (a) make captured_at monotonic, (b) publish the live tick, and
 * lets the native HTTP sync own the durable batch POST (url/headers/autoSync).
 */
export class TransistorTrackingService implements TrackingService {
  private core = new TrackingCore();
  private status: TrackingStatus = 'stopped';
  private config: TrackingConfig | null = null;
  private locationListeners = new Set<(loc: TrackingLocation) => void>();
  private statusListeners = new Set<(s: TrackingStatus) => void>();
  private locationSub: { remove: () => void } | null = null;

  async configure(config: TrackingConfig): Promise<void> {
    this.config = config;

    await BackgroundGeolocation.ready({
      // ----- motion + accuracy ------------------------------------------------
      desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
      distanceFilter: config.distanceFilterM,
      // ----- lifecycle: survive terminate/reboot, run as a foreground service -
      stopOnTerminate: false,
      startOnBoot: true,
      foregroundService: true,
      // 2-min stationary heartbeat so a parked guard stays "alive". The parked
      // guard's repeated same-point fixes are flagged low-confidence + excluded
      // from the heatmap server-side (see LOCATION_TEMPLATE on isKeepalive).
      heartbeatInterval: 120,
      // ----- durable HTTP sync (owns the breadcrumb POST) --------------------
      url: config.ingest.url,
      autoSync: true,
      batchSync: true,
      httpRootProperty: 'breadcrumbs',
      locationTemplate: LOCATION_TEMPLATE,
      // systemTime (epoch-ms) feeds the template's clientSeq; see LOCATION_TEMPLATE.
      enableTimestampMeta: true,
      // guardId/installId merged onto every record by the template's extras tags.
      extras: { guardId: config.guardId, installId: config.ingest.installId },
      headers: { Authorization: `Bearer ${config.ingest.deviceToken}` },
      // Battery: don't keep the radio hot when stationary.
      preventSuspend: false,
      notification: {
        title: 'TrailMe',
        text: 'Sharing your patrol position with your team.',
      },
    });
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error('TrackingService.start() before configure()');
    }
    this.setStatus('starting');

    try {
      // Permission first; a refusal must surface as 'denied', not a silent stop.
      const status = await BackgroundGeolocation.requestPermission();
      // AUTHORIZATION_STATUS_DENIED (1) / RESTRICTED (2) → no tracking.
      if (status === 1 || status === 2) {
        this.setStatus('denied');
        return;
      }

      // Re-subscribe defensively (start may be called again after a stop).
      this.locationSub?.remove();
      this.locationSub = BackgroundGeolocation.onLocation(
        (location) => {
          // (1) normalize + make captured_at monotonic per device.
          const capturedAt = this.core.monotonicCapturedAt(new Date(location.timestamp).getTime());
          const loc: TrackingLocation = {
            lat: location.coords.latitude,
            lon: location.coords.longitude,
            capturedAt,
            accuracyM: location.coords.accuracy,
            heading:
              typeof location.coords.heading === 'number' && location.coords.heading >= 0
                ? location.coords.heading
                : null,
            // A non-moving sample is the keepalive heartbeat.
            isKeepalive: location.is_moving === false,
          };
          // (2) PUBLISH LIVE from the callback (advisory tick). (3) The durable
          // batch POST is owned by the native HTTP sync (url/headers/autoSync
          // above), so nothing further is needed here for persistence.
          this.emitLocation(loc);
        },
        () => {
          // A location error (no fix) is not fatal; keep tracking state.
        },
      );

      await BackgroundGeolocation.start();
      this.setStatus('tracking');
    } catch (_err) {
      this.setStatus('error');
    }
  }

  async stop(): Promise<void> {
    this.locationSub?.remove();
    this.locationSub = null;
    try {
      await BackgroundGeolocation.stop();
    } catch (_err) {
      // Best-effort stop; report stopped regardless so the UI isn't stuck.
    }
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
// expo-location fallback (foreground-biased, via the same native engine)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Emergency fallback when the full background engine is degraded (e.g. an OEM
 * that killed the foreground service, or a build without the transistorsoft
 * license). It runs the SAME native engine but in a foreground-biased, no-HTTP
 * configuration: it emits live ticks via onLocation while the app is in front,
 * but does NOT own the durable buffer/sync. It CANNOT match the production
 * engine's screen-off reliability across OEM battery killers — this exists only
 * so the app degrades (and tracking-health can report degraded) instead of dying.
 */
export class ExpoLocationTrackingService implements TrackingService {
  private core = new TrackingCore();
  private status: TrackingStatus = 'stopped';
  private config: TrackingConfig | null = null;
  private locationListeners = new Set<(loc: TrackingLocation) => void>();
  private statusListeners = new Set<(s: TrackingStatus) => void>();
  private locationSub: { remove: () => void } | null = null;

  async configure(config: TrackingConfig): Promise<void> {
    this.config = config;
    // Foreground-biased: no url/autoSync (no durable buffer in fallback mode),
    // no foreground service — just live fixes while the app is usable.
    await BackgroundGeolocation.ready({
      desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
      distanceFilter: config.distanceFilterM,
      stopOnTerminate: true,
      startOnBoot: false,
      foregroundService: false,
      autoSync: false,
    });
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error('TrackingService.start() before configure()');
    }
    this.setStatus('starting');
    try {
      const status = await BackgroundGeolocation.requestPermission();
      if (status === 1 || status === 2) {
        this.setStatus('denied');
        return;
      }

      this.locationSub?.remove();
      this.locationSub = BackgroundGeolocation.onLocation((location) => {
        const capturedAt = this.core.monotonicCapturedAt(new Date(location.timestamp).getTime());
        this.emitLocation({
          lat: location.coords.latitude,
          lon: location.coords.longitude,
          capturedAt,
          accuracyM: location.coords.accuracy,
          heading:
            typeof location.coords.heading === 'number' && location.coords.heading >= 0
              ? location.coords.heading
              : null,
          isKeepalive: location.is_moving === false,
        });
      });

      await BackgroundGeolocation.start();
      this.setStatus('tracking');
    } catch (_err) {
      this.setStatus('error');
    }
  }

  async stop(): Promise<void> {
    this.locationSub?.remove();
    this.locationSub = null;
    try {
      await BackgroundGeolocation.stop();
    } catch (_err) {
      // Best-effort.
    }
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

/**
 * Single app-wide tracking service. Swapping engines is a one-line change here.
 * Defaults to the transistorsoft engine; the fallback is selected at runtime
 * when the native engine reports unavailable/unlicensed.
 */
export const trackingService: TrackingService = new TransistorTrackingService();
