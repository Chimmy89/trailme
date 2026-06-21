/**
 * Reusable Mapbox style-spec expressions for age-based fade.
 *
 * These are plain JSON arrays — byte-portable across mapbox-gl and rnmapbox.
 * Age is expressed as `ageNorm` ∈ [0,1] (0 = now, 1 = window edge), recomputed
 * each ~1Hz client tick and written onto each feature's properties (trails,
 * heatmap) or — for the trail line-gradient — derived from Mapbox's built-in
 * `line-progress` (0 at the oldest vertex … 1 at the newest, since trails are
 * stored newest-LAST and `lineMetrics` is enabled).
 */
import { FEATURE_PROPS } from './constants';
import type { Expression } from './types';

/** Reads a numeric feature property with a fallback when absent. */
function numberProp(name: string, fallback: number): Expression {
  return ['coalesce', ['to-number', ['get', name]], fallback];
}

/**
 * Opacity from a feature's `ageNorm`: fully opaque when fresh (0), fully
 * transparent at the window edge (1). Used for the trail line and live markers.
 */
export const ageFadeOpacity: Expression = [
  'interpolate',
  ['linear'],
  numberProp(FEATURE_PROPS.AGE_NORM, 1),
  0,
  1,
  1,
  0,
];

/**
 * TRAIL line-gradient: a single hue (set per layer to the guard's colour) that
 * fades from opaque at the newest end to transparent at the oldest end of the
 * line. Driven by `line-progress` (requires `lineMetrics: true` on the source).
 *
 * Because line-gradient ignores GL filters, the window is enforced by TRIMMING
 * the LineString's coordinates client-side, not by a filter expression.
 *
 * `[color]` is injected by `trailLineLayer(color)` so the same gradient shape
 * is reused for every guard with only the hue swapped.
 */
export function trailGradient(color: string): Expression {
  return [
    'interpolate',
    ['linear'],
    ['line-progress'],
    // oldest vertex: transparent
    0,
    'rgba(0,0,0,0)',
    // tail starts catching colour
    0.6,
    color,
    // newest vertex: full colour
    1,
    color,
  ];
}

/**
 * HEATMAP weight from point age: a freshly-walked cell weighs ~1 and decays to
 * ~0 as it ages out of the window, so a just-covered area glows then fades to
 * nothing. Keepalive and low-confidence points are excluded UPSTREAM (not added
 * to the coverage source) rather than zero-weighted here.
 */
export const heatmapAgeWeight: Expression = [
  'interpolate',
  ['linear'],
  numberProp(FEATURE_PROPS.AGE_NORM, 1),
  0,
  1,
  1,
  0,
];
