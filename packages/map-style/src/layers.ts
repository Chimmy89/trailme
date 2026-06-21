/**
 * Layer-factory objects for the three map render concerns.
 *
 * Each returns a portable {@link LayerSpec} (`id` + `type` + `paint`/`layout`)
 * built from plain JSON — no map-library import. mapbox-gl consumes these via
 * `map.addLayer(spec)`; rnmapbox consumes them by spreading
 * `{ ...spec.paint, ...spec.layout }` into a layer component's `style` prop.
 *
 * Live markers come in two layers meant to stack: a `circle` base (always
 * visible, cheap, colour/online via feature-state or property) and an optional
 * `symbol` arrow that rotates to `heading`.
 */
import { ACCURACY, FEATURE_PROPS, SOURCE_IDS, trailSourceId } from './constants';
import { ageFadeOpacity, heatmapAgeWeight, trailGradient } from './expressions';
import type { Expression, LayerSpec } from './types';

export const LAYER_IDS = {
  LIVE_MARKER_CIRCLE: 'trailme-live-marker-circle',
  LIVE_MARKER_ARROW: 'trailme-live-marker-arrow',
  COVERAGE_HEATMAP: 'trailme-coverage-heatmap',
  TRAIL_PREFIX: 'trailme-trail-line-',
} as const;

const colorProp: Expression = ['coalesce', ['get', FEATURE_PROPS.COLOR], '#2563eb'];

/**
 * (a) Live guard marker — base circle. Dims when offline; reads per-guard hue
 * from the feature's `color` property (set from `guardColor`).
 */
export function liveMarkerCircleLayer(): LayerSpec {
  return {
    id: LAYER_IDS.LIVE_MARKER_CIRCLE,
    type: 'circle',
    source: SOURCE_IDS.LIVE_POSITIONS,
    paint: {
      'circle-radius': 7,
      'circle-color': colorProp,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      // Online = solid; offline = faded so a stale marker reads as stale.
      'circle-opacity': ['case', ['get', FEATURE_PROPS.ONLINE], 1, 0.4],
    },
  };
}

/**
 * (a) Live guard marker — heading arrow (symbol). Requires an `arrow` image
 * registered on the map per platform (mapbox-gl `addImage`, rnmapbox `Images`);
 * hidden for features with no `heading`.
 */
export function liveMarkerArrowLayer(iconImage = 'trailme-arrow'): LayerSpec {
  return {
    id: LAYER_IDS.LIVE_MARKER_ARROW,
    type: 'symbol',
    source: SOURCE_IDS.LIVE_POSITIONS,
    layout: {
      'icon-image': iconImage,
      'icon-size': 0.5,
      'icon-rotate': ['coalesce', ['get', FEATURE_PROPS.HEADING], 0],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: {
      'icon-opacity': ['case', ['has', FEATURE_PROPS.HEADING], 1, 0],
    },
  };
}

/**
 * (b) Per-guard trail line with line-gradient age-fade. ONE layer + source per
 * guard (line-gradient can't be filtered per-feature), so pass the guard id and
 * its colour. The source MUST be created with `lineMetrics: true`. Low-
 * confidence points are rendered distinct by widening the dash upstream; here a
 * dashed underlay can be added by the caller if desired.
 */
export function trailLineLayer(guardId: string, color: string): LayerSpec {
  return {
    id: `${LAYER_IDS.TRAIL_PREFIX}${guardId}`,
    type: 'line',
    source: trailSourceId(guardId),
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-width': 3,
      // Gradient drives both colour and the newest→oldest alpha fade.
      'line-gradient': trailGradient(color),
      // A whole-line fade as the entire trail ages (in addition to per-vertex).
      'line-opacity': ageFadeOpacity,
    },
  };
}

/**
 * (c) Org-wide coverage heatmap. MONOCHROME recency density (not per-guard
 * tint): weight is driven by point age so fresh coverage glows and fades to
 * nothing. `heatmap-color` starts at fully transparent so untouched ground
 * shows no haze. Keepalive + low-confidence points are excluded from the
 * source upstream; `LOW_CONFIDENCE_M` documents the threshold used there.
 */
export function coverageHeatmapLayer(): LayerSpec {
  return {
    id: LAYER_IDS.COVERAGE_HEATMAP,
    type: 'heatmap',
    source: SOURCE_IDS.COVERAGE,
    paint: {
      'heatmap-weight': heatmapAgeWeight,
      'heatmap-intensity': 1,
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 12, 12, 16, 24],
      'heatmap-opacity': 0.85,
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(33,102,172,0)',
        0.2,
        'rgba(103,169,207,0.6)',
        0.4,
        'rgb(209,229,240)',
        0.6,
        'rgb(253,219,199)',
        0.8,
        'rgb(239,138,98)',
        1,
        'rgb(178,24,43)',
      ],
    },
  };
}

/** Re-exported so callers can reference the same threshold the source builder uses. */
export const LOW_CONFIDENCE_ACCURACY_M = ACCURACY.LOW_CONFIDENCE_M;
