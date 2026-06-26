// Live-position buffer maths for the M3 realtime cut-over, kept SEPARATE from React.
// The old poll handed us a server-decimated org snapshot every 1.5s; the broadcast
// feeds one server-stamped fix at a time, so we replicate the server contract
// client-side — per-guard 5s decimation + a 120-min prune — on the SAME LivePoint[]
// the trails/heatmap/markers memos already consume. Pure: no React, no DOM.

export type LivePoint = {
  guard_id: string;
  display_name: string | null;
  color: string | null;
  lat: number;
  lon: number;
  captured_at: string;
};

// The broadcast 'pos' payload (server-stamped relay) and the live_positions
// fallback row both arrive in this shape; only the LivePoint subset is rendered.
export type PosPayload = {
  guard_id: string;
  display_name: string | null;
  color: string | null;
  lat: number;
  lon: number;
  captured_at: string;
  site_id?: string;
  heading?: number | null;
  accuracy_m?: number | null;
  online?: boolean;
};

const MAX_BUFFER_MS = 120 * 60_000; // hold the largest window; memos trim to the selected one
const DECIMATE_MS = 5_000; // match trail_window's 5s server bucket

function toPoint(p: PosPayload): LivePoint {
  return {
    guard_id: p.guard_id,
    display_name: p.display_name,
    color: p.color,
    lat: p.lat,
    lon: p.lon,
    captured_at: p.captured_at,
  };
}

/**
 * Merge incoming fixes into the per-guard, oldest-first buffer:
 *  - fixes are bucketed into FIXED, epoch-aligned 5s windows — exactly matching the
 *    server's date_bin(interval '5 seconds', captured_at, epoch): the freshest fix
 *    per (guard, bucket) is kept, a fix in a NEW bucket APPENDS (so a 1 Hz moving
 *    guard yields ~1 pt/5s and its trail builds), and a parked guard never piles up;
 *  - an out-of-order OLDER fix is dropped (preserves line-gradient's newest-last
 *    invariant), as is an unparseable timestamp;
 *  - finally prune anything past 120 min to bound the buffer.
 *
 *  NB: bucket by floor(ms / 5000), NOT by the gap to the last kept point — a sliding
 *  gap would collapse a continuous sub-5s stream to a single perpetually-replaced
 *  point, and peer trails (which need >=2 points) would never form.
 */
export function mergePoints(prev: LivePoint[], incoming: PosPayload[], nowMs: number): LivePoint[] {
  const out = prev.slice();
  const lastIdx = new Map<string, number>();
  for (let i = 0; i < out.length; i++) lastIdx.set(out[i]!.guard_id, i);

  for (const raw of incoming) {
    const ptMs = Date.parse(raw.captured_at);
    if (Number.isNaN(ptMs)) continue;
    const pt = toPoint(raw);
    const li = lastIdx.get(pt.guard_id);
    if (li !== undefined) {
      const keptMs = Date.parse(out[li]!.captured_at);
      if (ptMs < keptMs) continue; // older than the last kept fix -> drop
      if (Math.floor(ptMs / DECIMATE_MS) === Math.floor(keptMs / DECIMATE_MS)) {
        out[li] = pt; // same epoch-aligned bucket -> keep the freshest
        continue;
      }
    }
    out.push(pt);
    lastIdx.set(pt.guard_id, out.length - 1);
  }

  const cutoff = nowMs - MAX_BUFFER_MS;
  return out.filter((p) => Date.parse(p.captured_at) >= cutoff);
}
