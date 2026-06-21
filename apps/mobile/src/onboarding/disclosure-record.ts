/**
 * Prominent-disclosure acknowledgement record.
 *
 * Before ANY tracking starts, the guard must accept the in-app disclosure
 * (shown BEFORE the OS permission prompt). Acceptance is written to
 * `guard_disclosures` (notice_version, tracking_mode_at_accept, accepted_at) so
 * the org can prove exactly what each guard was told — a GDPR transparency
 * requirement and a Play store-approval requirement. Tracking is gated on a row
 * existing for the CURRENT notice version. See ARCHITECTURE.md (M2 / disclosure).
 */
import { supabase } from '@/lib/supabase';
import type { GuardIdentity } from '@/tracking/session';

/**
 * The disclosure notice version. Bump when the disclosure COPY changes
 * materially so re-acceptance is required (an old acceptance no longer covers
 * the new notice). Kept in lockstep with the copy in onboarding/Disclosure.tsx.
 */
export const DISCLOSURE_NOTICE_VERSION = '2024-01';

/** True if the guard has already accepted the CURRENT notice version. */
export async function hasAcceptedDisclosure(identity: GuardIdentity): Promise<boolean> {
  const { data, error } = await supabase
    .from('guard_disclosures')
    .select('id')
    .eq('user_id', identity.guardId)
    .eq('org_id', identity.orgId)
    .eq('notice_version', DISCLOSURE_NOTICE_VERSION)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/**
 * Records the guard's acceptance of the current disclosure for their org under
 * the tracking mode in effect at acceptance time. Append-only (no update).
 */
export async function recordDisclosureAcceptance(
  identity: GuardIdentity,
  trackingMode: 'shift_gated' | 'always_on',
): Promise<void> {
  const { error } = await supabase.from('guard_disclosures').insert({
    user_id: identity.guardId,
    org_id: identity.orgId,
    notice_version: DISCLOSURE_NOTICE_VERSION,
    tracking_mode_at_accept: trackingMode,
  });
  if (error) throw error;
}
