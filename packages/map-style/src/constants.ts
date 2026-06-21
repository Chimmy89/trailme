/**
 * Shared constants for the map layers: the time windows (re-exported from the
 * single source of truth in `@trailme/shared`), GPS-accuracy thresholds, the
 * canonical GeoJSON source ids, and the feature-property keys the expressions
 * read. Web and mobile MUST populate GeoJSON with these exact property names or
 * the age-fade / weight expressions silently fall back to their defaults.
 */

// Re-exported so map code can import windows from one place alongside the
// layers, without a second import of @trailme/shared.
export { TIME_WINDOWS, type TimeWindow } from '@trailme/shared';

/**
 * Horizontal-accuracy thresholds, in metres.
 * - `MAX_INGEST_M`: the ingest function drops/flags fixes worse than this.
 * - `LOW_CONFIDENCE_M`: at/above this the point is rendered distinct and
 *   excluded from the heatmap (urban canyon / basement noise).
 */
export const ACCURACY = {
  MAX_INGEST_M: 50,
  LOW_CONFIDENCE_M: 35,
} as const;

/** Canonical GeoJSON source ids shared by web and mobile. */
export const SOURCE_IDS = {
  /** One FeatureCollection of live guard markers (Points). */
  LIVE_POSITIONS: 'trailme-live-positions',
  /** Org-wide breadcrumb Points feeding the recency heatmap. */
  COVERAGE: 'trailme-coverage',
  /**
   * Per-guard trail. There is ONE LineString source PER active guard (suffixed
   * with the guard id) because line-gradient cannot be filtered per-feature;
   * use `trailSourceId(guardId)` to build the id.
   */
  TRAIL_PREFIX: 'trailme-trail-',
} as const;

/** Builds the per-guard trail source id (one source per guard for line-gradient). */
export function trailSourceId(guardId: string): string {
  return `${SOURCE_IDS.TRAIL_PREFIX}${guardId}`;
}

/**
 * Feature-property keys read by the style expressions. The client's ~1Hz clock
 * recomputes `ageNorm` (normalised age in [0,1], 0 = now, 1 = window edge) on
 * every feature each tick; `lineProgress` is the per-vertex 0..1 used by the
 * trail's line-gradient (driven by Mapbox `line-progress`, not a property, but
 * named here for documentation).
 */
export const FEATURE_PROPS = {
  /** Normalised age in [0,1]; 0 = freshest, 1 = oldest still in window. */
  AGE_NORM: 'ageNorm',
  /** Bearing in degrees [0,360) for marker arrow rotation; absent = no arrow. */
  HEADING: 'heading',
  /** Per-guard hex colour (from `guardColor`) for marker + trail tint. */
  COLOR: 'color',
  /** Boolean flag for online/offline marker styling. */
  ONLINE: 'online',
  /** Boolean flag for low-confidence (high-accuracy-error) rendering. */
  LOW_CONFIDENCE: 'lowConfidence',
} as const;
