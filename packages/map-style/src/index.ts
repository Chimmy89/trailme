/**
 * @trailme/map-style
 *
 * Shared Mapbox style-spec building blocks — plain JS objects and expressions,
 * NOT a React component — consumed identically by the web map (mapbox-gl via
 * react-map-gl) and the mobile map (@rnmapbox/maps). Everything here is JSON
 * with zero map-library runtime dependency, so the two platforms fade and tint
 * the same data identically. See README for the one per-platform divergence
 * (paint/layout flattening + image registration).
 */

export {
  GUARD_PALETTE,
  guardColor,
} from './palette';

export {
  TIME_WINDOWS,
  type TimeWindow,
  ACCURACY,
  SOURCE_IDS,
  trailSourceId,
  FEATURE_PROPS,
} from './constants';

export {
  ageFadeOpacity,
  trailGradient,
  heatmapAgeWeight,
} from './expressions';

export {
  LAYER_IDS,
  LOW_CONFIDENCE_ACCURACY_M,
  liveMarkerCircleLayer,
  liveMarkerArrowLayer,
  trailLineLayer,
  coverageHeatmapLayer,
} from './layers';

export type {
  Expression,
  ExpressionValue,
  StyleValue,
  PaintSpec,
  LayoutSpec,
  LayerSpec,
} from './types';
