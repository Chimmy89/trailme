// Production-grade GPS smoothing: the canonical scalar constant-position Kalman
// filter ("Smooth GPS data", Stochastically / mizutori KalmanLatLong), run in a
// LOCAL METRIC frame so state, variance, accuracy and Q are all in metres.
//
// Why this replaces every ad-hoc filter we tried:
//   gain K = variance / (variance + accuracy^2)
//   - STILL  -> variance converges low -> K small -> coarse/noisy fixes barely
//     move the estimate (no wander), and a fix is NEVER dropped (no freeze).
//   - MOVING -> each step re-inflates variance by dt*Q^2 -> K stays large enough
//     that the new fix pulls the estimate along the path (tracks, small Q-set lag).
//   - reported accuracy feeds R directly: a 2 m fix moves the dot a lot, a 50 m
//     fix barely nudges it — an adaptive, accuracy-aware soft deadband.
// One tuning knob: Q (metres of expected motion per second). Lower = steadier +
// laggier; higher = snappier + jumpier.
//
// Pure: no React, no DOM. One instance per tracked entity (self + each peer).

import { metersBetween } from "./geo";

export type Fix = { lat: number; lng: number; accuracy: number; timestamp: number };
export type Filtered = { lat: number; lng: number; accuracy: number };

const EARTH_R = 6378137; // metres (WGS84 semi-major)
const DEFAULT_Q = 2; // m/s — foot patrol; 1.5 steadiest … 3 brisk
const DEFAULT_MIN_ACCURACY = 3; // m — floor so an over-confident fix can't snap the dot
const OUTLIER_SPEED = 30; // m/s — implausible for a guard on foot/in a car
const OUTLIER_ACCURACY = 50; // m — only down-weight a teleport if it's ALSO coarse

export class GpsKalman {
  private readonly q: number;
  private readonly minAcc: number;
  private variance = -1; // <0 => uninitialised
  private tMs = 0;
  private refLat = 0;
  private x = 0; // east metres from ref
  private y = 0; // north metres from ref
  private lat = 0;
  private lng = 0;
  private prevLat = 0;
  private prevLng = 0;
  private prevT = 0;
  private spd = 0;

  constructor(qMetresPerSec: number = DEFAULT_Q, minAccuracyM: number = DEFAULT_MIN_ACCURACY) {
    this.q = qMetresPerSec;
    this.minAcc = minAccuracyM;
  }

  /** Re-seed on the next fix (e.g. after the tab was hidden and the watch restarted). */
  reset(): void {
    this.variance = -1;
    this.spd = 0;
  }

  /** Speed (m/s) between the last two filtered points — for heading / push cadence. */
  get speed(): number {
    return this.spd;
  }

  private toMetres(lat: number, lng: number): [number, number] {
    const lat0 = (this.refLat * Math.PI) / 180;
    return [
      EARTH_R * ((lng * Math.PI) / 180) * Math.cos(lat0),
      EARTH_R * ((lat * Math.PI) / 180),
    ];
  }

  private toLatLng(x: number, y: number): [number, number] {
    const lat0 = (this.refLat * Math.PI) / 180;
    return [
      ((y / EARTH_R) * 180) / Math.PI,
      ((x / (EARTH_R * Math.cos(lat0))) * 180) / Math.PI,
    ];
  }

  /** Feed one raw fix; get the filtered position + honest 1-σ accuracy (metres). */
  update(fix: Fix): Filtered {
    let acc = Math.max(fix.accuracy, this.minAcc);

    // First fix: seed state honestly (large variance), no jump from (0,0).
    if (this.variance < 0) {
      this.refLat = fix.lat;
      [this.x, this.y] = this.toMetres(fix.lat, fix.lng);
      this.variance = acc * acc;
      this.tMs = fix.timestamp;
      this.lat = fix.lat;
      this.lng = fix.lng;
      this.prevLat = fix.lat;
      this.prevLng = fix.lng;
      this.prevT = fix.timestamp;
      this.spd = 0;
      return { lat: this.lat, lng: this.lng, accuracy: Math.sqrt(this.variance) };
    }

    // Outlier guard: an impossible-speed AND coarse fix gets its noise inflated
    // (down-weighted) instead of dropped — kills teleports without ever freezing.
    const gdt = (fix.timestamp - this.tMs) / 1000;
    if (gdt > 0) {
      const v = metersBetween(this.lng, this.lat, fix.lng, fix.lat) / gdt;
      if (v > OUTLIER_SPEED && fix.accuracy > OUTLIER_ACCURACY) acc *= 4;
    }

    // Predict: position unchanged; variance grows with elapsed time.
    if (gdt > 0) {
      this.variance += gdt * this.q * this.q;
      this.tMs = fix.timestamp;
    }

    // Update: scalar Kalman gain from the reported accuracy.
    const [mx, my] = this.toMetres(fix.lat, fix.lng);
    const k = this.variance / (this.variance + acc * acc);
    this.x += k * (mx - this.x);
    this.y += k * (my - this.y);
    this.variance = (1 - k) * this.variance;

    const [lat, lng] = this.toLatLng(this.x, this.y);

    const sdt = (fix.timestamp - this.prevT) / 1000;
    if (sdt > 0) {
      this.spd = metersBetween(this.prevLng, this.prevLat, lng, lat) / sdt;
      this.prevLat = lat;
      this.prevLng = lng;
      this.prevT = fix.timestamp;
    }

    this.lat = lat;
    this.lng = lng;
    return { lat, lng, accuracy: Math.sqrt(this.variance) };
  }
}
