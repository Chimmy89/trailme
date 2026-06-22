// Trail recording, kept SEPARATE from the live-dot Kalman (GPSLogger/Strava shape):
//   filter (accuracy + teleport) -> sample (5 m OR 5 s) -> simplify (RDP) on render.
// Fed the FILTERED position stream. Pure: no React, no DOM.

import { metersBetween } from "./geo";

export type TrailPoint = { lng: number; lat: number; t: number; acc: number };

const SAMPLE_MIN_DIST_M = 5;
const SAMPLE_MIN_TIME_MS = 5000;
const ACC_MAX_M = 50; // skip coarse fixes for the line...
const STALE_MS = 10000; // ...unless the trail has gone quiet, then accept best
const RDP_EPSILON_M = 2.5;

/** Stage 1+2: decide whether a filtered fix becomes a new trail vertex. */
export function pushTrailPoint(buf: TrailPoint[], p: TrailPoint): TrailPoint[] {
  const last = buf[buf.length - 1];
  if (!last) return [p];

  const stale = p.t - last.t > STALE_MS;
  if (p.acc > ACC_MAX_M && !stale) return buf; // soft accuracy gate

  const moved = metersBetween(last.lng, last.lat, p.lng, p.lat);
  if (moved < SAMPLE_MIN_DIST_M && p.t - last.t < SAMPLE_MIN_TIME_MS) return buf;

  return [...buf, p];
}

/** Stage 3: project to local metres, RDP-simplify, return [lng,lat][] for Mapbox. */
export function trailToLine(buf: TrailPoint[]): [number, number][] {
  if (buf.length < 2) return buf.map((p) => [p.lng, p.lat]);
  const lat0 = buf.reduce((s, p) => s + p.lat, 0) / buf.length;
  const mLat = 111320;
  const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const xy: [number, number][] = buf.map((p) => [p.lng * mLng, p.lat * mLat]);
  const simplified = rdp(xy, RDP_EPSILON_M);
  return simplified.map(([x, y]) => [x / mLng, y / mLat]);
}

// --- Ramer–Douglas–Peucker (iterative, operates in projected metres) ---
function rdp(points: [number, number][], epsilon: number): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const seg = stack.pop();
    if (!seg) break;
    const [start, end] = seg;
    const a = points[start];
    const b = points[end];
    if (!a || !b) continue;
    let maxD = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const p = points[i];
      if (!p) continue;
      const d = perpDist(p, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = true;
      stack.push([start, idx], [idx, end]);
    }
  }

  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (keep[i] && p) out.push(p);
  }
  return out;
}

function perpDist(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = p;
  const [ax, ay] = a;
  const [bx, by] = b;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
