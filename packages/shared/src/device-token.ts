import { z } from 'zod';

/**
 * DEVICE-TOKEN CLAIM SHAPE.
 *
 * A dedicated, longer-lived (~24h) device-scoped JWT minted server-side after
 * interactive auth and used ONLY by the native HTTP sync to flush the durable
 * breadcrumb buffer. It is decoupled from the 1h interactive session so a long
 * offline shift doesn't 401 mid-flush; the short TTL stays on the interactive
 * token for fast revocation of reads/realtime.
 *
 * `kind: 'device'` distinguishes it from an interactive user JWT so the ingest
 * function can refuse anything that isn't a device token. The claims are
 * re-verified against `memberships` inside the SECURITY DEFINER ingest RPC —
 * defense-in-depth, never trusted on their own.
 */
export const DEVICE_TOKEN_KIND = 'device';

export const DeviceTokenClaimsSchema = z.object({
  org_id: z.string().uuid(),
  guard_id: z.string().uuid(),
  site_ids: z.array(z.string().uuid()),
  // Per-install epoch. The client generates this UUID once per install and sends
  // it when requesting a device token; the minter stamps it into the token so the
  // ingest function can authoritatively attach it to every fix (the client cannot
  // forge a different install_id per row — it is taken from the verified token).
  // Scopes the per-install clientSeq across reinstalls so a reset counter is not
  // mistaken for a replay.
  install_id: z.string().uuid(),
  kind: z.literal(DEVICE_TOKEN_KIND),
});
export type DeviceTokenClaims = z.infer<typeof DeviceTokenClaimsSchema>;
