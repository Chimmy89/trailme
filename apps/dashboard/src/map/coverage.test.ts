import { describe, it, expect } from "vitest";
import { ageNorm, buildCoverageGeoJSON, type CoveragePoint } from "./coverage";

const NOW = 1_700_000_000_000; // fixed reference; no Date.now() so runs are identical.
const WINDOW = 15 * 60_000; // 15 min

/** A point captured `agoMs` before NOW, at the given lon/lat. */
function pt(agoMs: number, lon = 10.75, lat = 59.91): CoveragePoint {
  return { lon, lat, captured_at: new Date(NOW - agoMs).toISOString() };
}

describe("ageNorm", () => {
  it("is 0 when captured exactly now (full weight)", () => {
    expect(ageNorm(NOW, NOW, WINDOW)).toBe(0);
  });

  it("is 1 at the window edge (zero weight)", () => {
    expect(ageNorm(NOW - WINDOW, NOW, WINDOW)).toBe(1);
  });

  it("clamps a future timestamp to 0", () => {
    expect(ageNorm(NOW + 60_000, NOW, WINDOW)).toBe(0);
  });

  it("clamps a straggler older than the window to 1", () => {
    expect(ageNorm(NOW - 2 * WINDOW, NOW, WINDOW)).toBe(1);
  });

  it("is linear in between (half-window -> 0.5)", () => {
    expect(ageNorm(NOW - WINDOW / 2, NOW, WINDOW)).toBeCloseTo(0.5, 6);
  });
});

describe("buildCoverageGeoJSON", () => {
  it("drops points older than the window, keeps fresh ones", () => {
    const fc = buildCoverageGeoJSON([pt(0), pt(WINDOW + 1000), pt(WINDOW / 2)], NOW, WINDOW);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(2);
  });

  it("writes a numeric ageNorm in [0,1] under the key 'ageNorm'", () => {
    const fc = buildCoverageGeoJSON([pt(0), pt(WINDOW / 2)], NOW, WINDOW);
    for (const f of fc.features) {
      expect(typeof f.properties.ageNorm).toBe("number");
      expect(f.properties.ageNorm).toBeGreaterThanOrEqual(0);
      expect(f.properties.ageNorm).toBeLessThanOrEqual(1);
      expect(f.geometry.type).toBe("Point");
    }
    // freshest point -> ageNorm 0
    expect(fc.features[0]?.properties.ageNorm).toBe(0);
  });

  it("includes every point regardless of guard (self not excluded)", () => {
    // The builder takes a superset shape; extra fields (guard_id) are ignored,
    // and nothing is filtered by guard — coverage is org-wide incl. self.
    const points = [
      { ...pt(0), guard_id: "self" },
      { ...pt(1000), guard_id: "peer" },
    ];
    const fc = buildCoverageGeoJSON(points, NOW, WINDOW);
    expect(fc.features).toHaveLength(2);
  });

  it("skips a point with an unparseable captured_at", () => {
    const fc = buildCoverageGeoJSON(
      [pt(0), { lon: 10.75, lat: 59.91, captured_at: "not-a-date" }],
      NOW,
      WINDOW,
    );
    expect(fc.features).toHaveLength(1);
  });

  it("returns an empty collection for no in-window points", () => {
    const fc = buildCoverageGeoJSON([pt(WINDOW + 1)], NOW, WINDOW);
    expect(fc.features).toHaveLength(0);
  });

  it("keeps a point captured exactly at the window edge (strict <, ageNorm 1)", () => {
    // Pins `<` vs `<=`: the edge is in-window with zero weight, matching the trail filter.
    const fc = buildCoverageGeoJSON([pt(WINDOW)], NOW, WINDOW);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.properties.ageNorm).toBe(1);
  });
});

describe("buildCoverageGeoJSON spatial binning", () => {
  it("collapses near-coincident points to one feature, keeping the freshest", () => {
    // Two points ~1 m apart in time-order old-then-new; binning to 8 m keeps the
    // fresher (smaller ageNorm).
    const lon = 10.75;
    const lat = 59.91;
    const older = { lon, lat, captured_at: new Date(NOW - WINDOW / 2).toISOString() };
    const newerNearby = {
      lon: lon + 0.00001, // ~0.6 m east
      lat,
      captured_at: new Date(NOW).toISOString(),
    };
    const fc = buildCoverageGeoJSON([older, newerNearby], NOW, WINDOW, { binMeters: 8 });
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]?.properties.ageNorm).toBe(0); // the fresher one won
  });

  it("keeps points farther apart than the bin as separate features", () => {
    const a = { lon: 10.75, lat: 59.91, captured_at: new Date(NOW).toISOString() };
    const b = { lon: 10.7505, lat: 59.91, captured_at: new Date(NOW).toISOString() }; // ~28 m east
    const fc = buildCoverageGeoJSON([a, b], NOW, WINDOW, { binMeters: 8 });
    expect(fc.features).toHaveLength(2);
  });

  it("does not bin when binMeters is 0/absent", () => {
    const lon = 10.75;
    const lat = 59.91;
    const p1 = { lon, lat, captured_at: new Date(NOW).toISOString() };
    const p2 = { lon: lon + 0.00001, lat, captured_at: new Date(NOW - 1000).toISOString() };
    expect(buildCoverageGeoJSON([p1, p2], NOW, WINDOW).features).toHaveLength(2);
    expect(buildCoverageGeoJSON([p1, p2], NOW, WINDOW, { binMeters: 0 }).features).toHaveLength(2);
  });
});
