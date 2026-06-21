import { z } from 'zod';

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * One guard's entry in a consolidated live-positions broadcast.
 *
 * The relay stamps `guardId` from the authenticated `guard_positions` upsert,
 * so a client CANNOT impersonate a peer — this payload's identity is
 * server-authoritative, not taken from a client tick. Live ticks are ADVISORY;
 * `guard_positions` (RLS-protected) is the authoritative last-known marker.
 *
 * - `heading` is bearing in degrees [0, 360); null when unknown/stationary.
 * - `capturedAt` is the device event time (ISO-8601) of this position.
 * - `online` reflects Presence/staleness at relay time.
 */
export const PositionSchema = z.object({
  guardId: z.string().uuid(),
  lat: latitude,
  lon: longitude,
  heading: z.number().min(0).max(360).nullable(),
  capturedAt: z.string().datetime({ offset: true }),
  online: z.boolean(),
});
export type Position = z.infer<typeof PositionSchema>;

/**
 * The CONSOLIDATED 'positions' broadcast payload: ONE message per site per tick
 * carrying every active guard's server-stamped position. Subscribers apply the
 * whole batch with a single `setData`. This replaces quadratic peer-to-peer
 * broadcast (one message, not one-per-peer-per-peer).
 */
export const PositionsBroadcastSchema = z.object({
  siteId: z.string().uuid(),
  positions: z.array(PositionSchema),
});
export type PositionsBroadcast = z.infer<typeof PositionsBroadcastSchema>;

/** Broadcast `event` name used on the per-site channel for the consolidated tick. */
export const POSITIONS_BROADCAST_EVENT = 'positions';
