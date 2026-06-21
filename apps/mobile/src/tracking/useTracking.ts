/**
 * useTracking — the shift-gated tracking lifecycle as a hook.
 *
 * Owns the configure → start / stop dance so screens don't each duplicate it:
 *   - resolves the guard's identity from the live session,
 *   - mints the ~24h device token and builds the ingest endpoint,
 *   - configures the TrackingService with the durable-sync wiring,
 *   - exposes start()/stop() that the shift screen calls on clock-in/out,
 *   - refuses to start until the disclosure has been accepted (privacy gate).
 *
 * The server gate is authoritative (window-based on captured_at); this hook only
 * starts/stops the engine so the device doesn't burn GPS/battery off-shift.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { hasAcceptedDisclosure } from '@/onboarding/disclosure-record';
import { ingestBreadcrumbsUrl, mintDeviceToken } from './ingest';
import { identityFromSession, type GuardIdentity } from './session';
import { trackingService, type TrackingLocation, type TrackingStatus } from './TrackingService';

// Mobile distance gate (metres). Background live cadence ~= this.
const DISTANCE_FILTER_M = 20;

export interface UseTracking {
  status: TrackingStatus;
  identity: GuardIdentity | null;
  /** Most recent live fix observed (for centering the map / checkpoint UX). */
  lastLocation: TrackingLocation | null;
  /** Non-null when configure/start failed (token mint, disclosure, etc.). */
  error: string | null;
  /** Configure (if needed) + start the engine. No-op if already tracking. */
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useTracking(): UseTracking {
  const [status, setStatus] = useState<TrackingStatus>(trackingService.getStatus());
  const [identity, setIdentity] = useState<GuardIdentity | null>(null);
  const [lastLocation, setLastLocation] = useState<TrackingLocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const configuredRef = useRef(false);

  // Resolve identity from the current session, and keep it fresh across refreshes.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setIdentity(identityFromSession(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setIdentity(identityFromSession(next));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Mirror engine status + live fixes into state.
  useEffect(() => {
    const offStatus = trackingService.onStatusChange(setStatus);
    const offLoc = trackingService.onLocation(setLastLocation);
    return () => {
      offStatus();
      offLoc();
    };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const id = identityFromSession(session);
      if (!session || !id) {
        setError('Not signed in or no active membership.');
        return;
      }

      // PRIVACY GATE: tracking cannot start before the disclosure is accepted.
      if (!(await hasAcceptedDisclosure(id))) {
        setError('disclosure_required');
        return;
      }

      // Configure once per app run (token mint + durable-sync wiring).
      if (!configuredRef.current) {
        const device = await mintDeviceToken(session);
        await trackingService.configure({
          mode: 'shift_gated',
          guardId: id.guardId,
          distanceFilterM: DISTANCE_FILTER_M,
          ingest: {
            url: ingestBreadcrumbsUrl(),
            deviceToken: device.token,
            installId: device.installId,
          },
        });
        configuredRef.current = true;
      }

      await trackingService.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start tracking.');
    }
  }, []);

  const stop = useCallback(async () => {
    setError(null);
    try {
      await trackingService.stop();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop tracking.');
    }
  }, []);

  return { status, identity, lastLocation, error, start, stop };
}
