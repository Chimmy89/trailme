import { describe, it, expect } from "vitest";
import { GpsKalman, type Fix } from "./gpsKalman";
import { metersBetween } from "./geo";

// Seeded LCG so every run is identical.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
function gauss(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const LAT = 59.9139;
const LNG = 10.7522;
const M_PER_DEG_LAT = 111320;
const mPerDegLng = (lat: number): number => 111320 * Math.cos((lat * Math.PI) / 180);
function offset(lat: number, lng: number, eastM: number, northM: number): { lat: number; lng: number } {
  return { lat: lat + northM / M_PER_DEG_LAT, lng: lng + eastM / mPerDegLng(lat) };
}
function stddev(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

describe("GpsKalman", () => {
  it("1. stationary: output spread is far smaller than input spread (no wander)", () => {
    const rand = lcg(42);
    const kf = new GpsKalman(2, 3);
    const sigma = 10;
    const inLat: number[] = [];
    const inLng: number[] = [];
    const outLat: number[] = [];
    const outLng: number[] = [];
    let t = 1_000_000;
    for (let i = 0; i < 100; i++) {
      const p = offset(LAT, LNG, gauss(rand) * sigma, gauss(rand) * sigma);
      inLat.push(p.lat);
      inLng.push(p.lng);
      const f = kf.update({ lat: p.lat, lng: p.lng, accuracy: sigma, timestamp: t });
      outLat.push(f.lat);
      outLng.push(f.lng);
      t += 1000;
    }
    const inSpread = Math.hypot(stddev(inLat) * M_PER_DEG_LAT, stddev(inLng) * mPerDegLng(LAT));
    // Measure the converged (steady-state) spread — skip the initial convergence
    // transient where the estimate walks in from the first noisy seed.
    const cLat = outLat.slice(25);
    const cLng = outLng.slice(25);
    const outSpread = Math.hypot(stddev(cLat) * M_PER_DEG_LAT, stddev(cLng) * mPerDegLng(LAT));
    expect(outSpread).toBeLessThan(inSpread / 3);
  });

  it("2. moving: output follows a 1.4 m/s walk within a small lag (not frozen)", () => {
    const kf = new GpsKalman(2, 3);
    const v = 1.4; // m/s east
    let t = 1_000_000;
    let worst = 0;
    let lastF = { lat: LAT, lng: LNG };
    for (let i = 0; i < 60; i++) {
      const trueP = offset(LAT, LNG, v * i, 0);
      const f = kf.update({ lat: trueP.lat, lng: trueP.lng, accuracy: 8, timestamp: t });
      lastF = f;
      worst = Math.max(worst, metersBetween(trueP.lng, trueP.lat, f.lng, f.lat));
      t += 1000;
    }
    const finalTrue = offset(LAT, LNG, v * 59, 0);
    // Steady-state tracking lag at σ=8 m, Q=2: ~5 m here; ~2 m at real ±3-4 m GPS.
    expect(metersBetween(finalTrue.lng, finalTrue.lat, lastF.lng, lastF.lat)).toBeLessThan(6);
    expect(worst).toBeLessThan(8);
  });

  it("3. a coarse fix moves the estimate less than an accurate one (accuracy-weighting)", () => {
    const settle = (kf: GpsKalman) => {
      let t = 1_000_000;
      for (let i = 0; i < 30; i++) {
        kf.update({ lat: LAT, lng: LNG, accuracy: 8, timestamp: t });
        t += 1000;
      }
      return t;
    };
    const kfCoarse = new GpsKalman(2, 3);
    let t = settle(kfCoarse);
    const jump = offset(LAT, LNG, 30, 0);
    const coarse = kfCoarse.update({ lat: jump.lat, lng: jump.lng, accuracy: 50, timestamp: t });
    const dCoarse = metersBetween(LNG, LAT, coarse.lng, coarse.lat);

    const kfFine = new GpsKalman(2, 3);
    t = settle(kfFine);
    const fine = kfFine.update({ lat: jump.lat, lng: jump.lng, accuracy: 5, timestamp: t });
    const dFine = metersBetween(LNG, LAT, fine.lng, fine.lat);

    expect(dCoarse).toBeLessThan(dFine);
    expect(dCoarse).toBeLessThan(8);
  });

  it("4. first fix is identity (seed, no jump) with a floored accuracy", () => {
    const kf = new GpsKalman(2, 3);
    const fix: Fix = { lat: LAT, lng: LNG, accuracy: 1, timestamp: 1_000_000 };
    const f = kf.update(fix);
    expect(Math.abs(f.lat - LAT)).toBeLessThan(1e-9);
    expect(Math.abs(f.lng - LNG)).toBeLessThan(1e-9);
    expect(f.accuracy).toBeCloseTo(3, 6); // max(reported 1, min 3)
  });

  it("5. outlier guard: a 5 km/1 s teleport barely moves the dot, a real step is accepted", () => {
    const kf = new GpsKalman(2, 3);
    let t = 1_000_000;
    for (let i = 0; i < 30; i++) {
      kf.update({ lat: LAT, lng: LNG, accuracy: 8, timestamp: t });
      t += 1000;
    }
    const far = offset(LAT, LNG, 5000, 0);
    const teleported = kf.update({ lat: far.lat, lng: far.lng, accuracy: 200, timestamp: t });
    expect(metersBetween(LNG, LAT, teleported.lng, teleported.lat)).toBeLessThan(5);
    t += 1000;
    const step = offset(LAT, LNG, 1.4, 0);
    const after = kf.update({ lat: step.lat, lng: step.lng, accuracy: 8, timestamp: t });
    // still near the true cluster, not stuck out at 5 km
    expect(metersBetween(LNG, LAT, after.lng, after.lat)).toBeLessThan(10);
  });

  it("6. reported accuracy (halo) shrinks below the measurement noise over a still run", () => {
    const rand = lcg(7);
    const kf = new GpsKalman(2, 3);
    let last = Infinity;
    let t = 1_000_000;
    for (let i = 0; i < 100; i++) {
      const p = offset(LAT, LNG, gauss(rand) * 10, gauss(rand) * 10);
      const f = kf.update({ lat: p.lat, lng: p.lng, accuracy: 10, timestamp: t });
      last = f.accuracy;
      t += 1000;
    }
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(10);
  });
});
