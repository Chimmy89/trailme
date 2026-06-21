import { router } from 'expo-router';
import { useState } from 'react';

import { Disclosure } from '@/onboarding/Disclosure';
import { recordDisclosureAcceptance } from '@/onboarding/disclosure-record';
import { supabase } from '@/lib/supabase';
import { identityFromSession } from '@/tracking/session';
import { requestLocationPermission } from '@/tracking/permission';

/**
 * Prominent-disclosure route (presented as a modal — see app/_layout.tsx).
 *
 * Shown BEFORE the OS permission prompt. On acknowledgement it records the
 * acceptance into guard_disclosures under the org's current tracking mode, THEN
 * triggers the OS location prompt, then returns to the shift screen so the guard
 * can clock in (tracking is gated on the acceptance row existing).
 */
export default function DisclosureRoute() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const identity = identityFromSession(data.session);
      if (!identity) {
        setError('Not signed in or no active membership.');
        return;
      }

      // Tracking mode in effect at acceptance time (defaults to shift_gated).
      const { data: settings } = await supabase
        .from('org_settings')
        .select('tracking_mode')
        .eq('org_id', identity.orgId)
        .maybeSingle();
      const mode =
        (settings as { tracking_mode?: 'shift_gated' | 'always_on' } | null)?.tracking_mode ??
        'shift_gated';

      await recordDisclosureAcceptance(identity, mode);

      // Now (and only now) prompt for the OS location permission.
      await requestLocationPermission();

      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record acceptance.');
    } finally {
      setBusy(false);
    }
  }

  return <Disclosure onAcknowledge={acknowledge} busy={busy} error={error} />;
}
