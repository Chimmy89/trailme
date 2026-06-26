// Coverage-heatmap source builder, kept SEPARATE from the live-dot/trail code.
// Maps the site-scoped breadcrumb cloud (seeded from trail_window + fed by the
// site:{id} realtime broadcast, 5s-decimated client-side in livePoints.mergePoints,
// low-confidence/keepalive already excluded server-side) into a GeoJSON Point collection
// where each feature carries a recency weight `ageNorm` ∈ [0,1] (0 = now, 1 =
// window edge). The @trailme/map-style heatmap reads that exact property, so a
// freshly-walked spot glows and an aging one fades to nothing. Pure: no React, no DOM.

import { FEATURE_PROPS } from "@trailme/map-style";

/** Minimal shape this module needs from a live-map point (LivePoint is a superset). */
export type CoveragePoint = { lon: number; lat: number; captured_at: string };

type CoverageFeature = {
  type: "Feature";
  properties: { ageNorm: number };
  geometry: { type: "Point"; coordinates: [number, number] };
};

export type CoverageCollection = {
  type: "FeatureCollection";
  features: CoverageFeature[];
};

/**
 * Normalised age in [0,1]: 0 when captured now (full heatmap weight), 1 at the
 * window edge (zero weight). Clamped low so a clock-skewed future timestamp can't
 * exceed full weight, and high as belt-and-suspenders (callers already drop points
 * older than the window before calling this).
 */
export function ageNorm(capturedMs: number, nowMs: number, windowMs: number): number {
  if (windowMs <= 0) return 1;
  return Math.min(1, Math.max(0, (nowMs - capturedMs) / windowMs));
}

function makeFeature(lon: number, lat: number, age: number): CoverageFeature {
  // Computed key from FEATURE_PROPS so the property can never drift from the
  // heatmap-weight expression's getter; cast bridges the literal-key inference.
  return {
    type: "Feature",
    properties: { [FEATURE_PROPS.AGE_NORM]: age } as { ageNorm: number },
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

/**
 * Snap features to an ~`binMeters` grid and keep ONE per cell — the FRESHEST
 * (min ageNorm). Turns "time spent" (a parked guard stacking many points in one
 * spot) into "area covered with recency", which is the coverage story. Off by
 * default; enabled by the caller's `binMeters` option.
 */
function spatialBin(features: CoverageFeature[], binMeters: number): CoverageFeature[] {
  if (features.length === 0) return features;
  const meanLat =
    features.reduce((s, f) => s + f.geometry.coordinates[1], 0) / features.length;
  const dLat = binMeters / 111320;
  const dLng = binMeters / (111320 * Math.cos((meanLat * Math.PI) / 180));
  const cells = new Map<string, CoverageFeature>();
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const key = `${Math.round(lon / dLng)}:${Math.round(lat / dLat)}`;
    const existing = cells.get(key);
    if (!existing || f.properties.ageNorm < existing.properties.ageNorm) {
      cells.set(key, f);
    }
  }
  return [...cells.values()];
}

/**
 * Build the coverage heatmap source from polled points. Includes EVERY guard's
 * points (self too — coverage is org-wide ground covered), drops anything older
 * than the window or with an unparseable timestamp, and writes the per-point
 * recency weight. `opts.binMeters > 0` applies the dwell-blob dedupe.
 */
export function buildCoverageGeoJSON(
  points: CoveragePoint[],
  nowMs: number,
  windowMs: number,
  opts?: { binMeters?: number },
): CoverageCollection {
  const cutoff = nowMs - windowMs;
  const features: CoverageFeature[] = [];
  for (const p of points) {
    const capturedMs = Date.parse(p.captured_at);
    if (Number.isNaN(capturedMs)) continue;
    if (capturedMs < cutoff) continue;
    features.push(makeFeature(p.lon, p.lat, ageNorm(capturedMs, nowMs, windowMs)));
  }
  const binned =
    opts?.binMeters && opts.binMeters > 0 ? spatialBin(features, opts.binMeters) : features;
  return { type: "FeatureCollection", features: binned };
}
