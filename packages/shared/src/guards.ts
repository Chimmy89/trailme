import {
  RETENTION_DAYS,
  ROLES,
  TIME_WINDOWS,
  TRACKING_MODES,
  type RetentionDays,
  type Role,
  type TimeWindow,
  type TrackingMode,
} from './enums';

/**
 * Small runtime type guards over the closed enums, plus an exhaustiveness
 * helper. Each guard narrows an `unknown`/`number` to the corresponding literal
 * union so values arriving from the wire (query params, JWT claims, JSON
 * bodies) can be validated without pulling in zod for a single membership test.
 */

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isTrackingMode(value: unknown): value is TrackingMode {
  return typeof value === 'string' && (TRACKING_MODES as readonly string[]).includes(value);
}

export function isRetentionDays(value: unknown): value is RetentionDays {
  return typeof value === 'number' && (RETENTION_DAYS as readonly number[]).includes(value);
}

export function isTimeWindow(value: unknown): value is TimeWindow {
  return typeof value === 'number' && (TIME_WINDOWS as readonly number[]).includes(value);
}

/**
 * Exhaustiveness guard. Place in the `default` of a switch over a union to make
 * the compiler error if a new variant is added but left unhandled. Throws at
 * runtime if reached anyway.
 */
export function assertNever(value: never, message = 'Unexpected value'): never {
  throw new Error(`${message}: ${String(value)}`);
}
