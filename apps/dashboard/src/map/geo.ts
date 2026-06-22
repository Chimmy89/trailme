// Pure geo helpers shared by the GPS filter, trail decimator, and accuracy circle.
// No React, no DOM — unit-testable.

const EARTH_R = 6371000; // metres

/** Great-circle distance in metres between two lon/lat points (haversine). */
export function metersBetween(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

/**
 * A geodesic-ish circle as a GeoJSON polygon (metres-true at the given centre),
 * for the translucent "accuracy halo" around the live dot. Built as a plain
 * object (same shape the rest of MapShell feeds to a Mapbox Source).
 */
export function circlePolygon(lng: number, lat: number, radiusM: number, steps = 48) {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return {
    type: "Feature" as const,
    properties: {},
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}
