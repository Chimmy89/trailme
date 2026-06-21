/**
 * Realtime channel naming.
 *
 * Live positions are scoped to a private per-site channel `site:{siteId}`.
 * Realtime Authorization RLS on `realtime.messages` validates that the parsed
 * `siteId` is a UUID the joiner is actually entitled to (the channel suffix is
 * attacker-controlled), so this helper is purely the name builder — it does not
 * grant access.
 */

/** Channel-name prefix for per-site live position channels. */
export const SITE_CHANNEL_PREFIX = 'site:';

/** Builds the private realtime channel name for a site's live positions. */
export function channelName(siteId: string): string {
  return `${SITE_CHANNEL_PREFIX}${siteId}`;
}
