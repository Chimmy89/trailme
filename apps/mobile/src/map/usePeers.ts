/**
 * usePeers — same-site peer positions + trails for the mobile map.
 *
 * Data sources (mobile is capped to SAME-SITE peers only, per the render-cap):
 *   - SEED + TRAIL: the `trail_window(p_site, p_minutes)` RPC returns
 *     server-decimated `{ guard_id, lat, lon, captured_at }` rows (audited,
 *     live-membership-checked, low-confidence/keepalive excluded). The newest
 *     row per guard seeds that guard's live marker; all rows form the trail.
 *   - LIVE: the private `site:{siteId}` realtime channel carries the
 *     consolidated `positions` broadcast (server-stamped identity). Each tick
 *     advances the live markers; guard_positions is authoritative and trail_window
 *     is the seed, so a tick only moves a marker for a guard already in scope.
 *
 * The window selector re-runs trail_window on change. Growing may refetch;
 * the architecture's pure-client-trim-on-shrink optimization is a later refinement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  POSITIONS_BROADCAST_EVENT,
  PositionsBroadcastSchema,
  channelName,
  type TimeWindow,
} from '@trailme/shared';
import { supabase } from '@/lib/supabase';
import { identityFromSession } from '@/tracking/session';

/** One trail point in time order (oldest first) for a guard. */
export interface TrailPoint {
  lat: number;
  lon: number;
  capturedAt: string;
}

/** A peer's current marker + recent trail. */
export interface Peer {
  guardId: string;
  lat: number;
  lon: number;
  heading: number | null;
  online: boolean;
  trail: TrailPoint[];
}

interface TrailWindowRow {
  guard_id: string;
  lat: number;
  lon: number;
  captured_at: string;
}

export interface UsePeers {
  peers: Peer[];
  siteId: string | null;
  loading: boolean;
  error: string | null;
}

export function usePeers(windowMinutes: TimeWindow): UsePeers {
  const [siteId, setSiteId] = useState<string | null>(null);
  const [trailByGuard, setTrailByGuard] = useState<Record<string, TrailPoint[]>>({});
  // Live overlay: newest broadcast position per guard (advisory, reconciled).
  const [liveByGuard, setLiveByGuard] = useState<
    Record<string, { lat: number; lon: number; heading: number | null; online: boolean }>
  >({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selfRef = useRef<string | null>(null);

  // Resolve the guard's site (same-site peers only) + own id (to exclude self).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const id = identityFromSession(data.session);
      selfRef.current = id?.guardId ?? null;
      setSiteId(id?.siteIds[0] ?? null);
    });
  }, []);

  // Seed + trail from trail_window whenever the site or window changes.
  const loadTrails = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('trail_window', {
      p_site: siteId,
      p_minutes: windowMinutes,
    });
    setLoading(false);
    if (e) {
      setError(e.message);
      return;
    }
    const rows = (data ?? []) as TrailWindowRow[];
    const byGuard: Record<string, TrailPoint[]> = {};
    for (const row of rows) {
      if (row.guard_id === selfRef.current) continue; // peers only
      (byGuard[row.guard_id] ??= []).push({
        lat: row.lat,
        lon: row.lon,
        capturedAt: row.captured_at,
      });
    }
    setTrailByGuard(byGuard);
  }, [siteId, windowMinutes]);

  useEffect(() => {
    void loadTrails();
  }, [loadTrails]);

  // Subscribe to the consolidated per-site live broadcast.
  useEffect(() => {
    if (!siteId) return;
    const channel = supabase.channel(channelName(siteId), {
      config: { private: true },
    });

    channel.on('broadcast', { event: POSITIONS_BROADCAST_EVENT }, ({ payload }) => {
      const parsed = PositionsBroadcastSchema.safeParse(payload);
      if (!parsed.success || parsed.data.siteId !== siteId) return;
      setLiveByGuard((prev) => {
        const next = { ...prev };
        for (const p of parsed.data.positions) {
          if (p.guardId === selfRef.current) continue; // peers only
          next[p.guardId] = {
            lat: p.lat,
            lon: p.lon,
            heading: p.heading,
            online: p.online,
          };
        }
        return next;
      });
    });

    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [siteId]);

  // Merge: live overlay wins for the marker; trail_window provides the trail and
  // the seed marker for guards with no live tick yet.
  const peers = useMemo<Peer[]>(() => {
    const ids = new Set([...Object.keys(trailByGuard), ...Object.keys(liveByGuard)]);
    const out: Peer[] = [];
    for (const guardId of ids) {
      const trail = trailByGuard[guardId] ?? [];
      const live = liveByGuard[guardId];
      const seed = trail.length > 0 ? trail[trail.length - 1] : undefined;
      const lat = live?.lat ?? seed?.lat;
      const lon = live?.lon ?? seed?.lon;
      if (lat === undefined || lon === undefined) continue;
      out.push({
        guardId,
        lat,
        lon,
        heading: live?.heading ?? null,
        online: live?.online ?? false,
        trail,
      });
    }
    return out;
  }, [trailByGuard, liveByGuard]);

  return { peers, siteId, loading, error };
}
