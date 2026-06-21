/**
 * Closed enumerations shared across the platform.
 *
 * Each is defined ONCE as a `const` tuple (the runtime source of truth, e.g.
 * for zod `z.enum(...)` and UI option lists) with its literal-union TYPE
 * derived from that same tuple — so the values and the type can never drift.
 */

/** Membership roles, lowest-to-highest privilege. */
export const ROLES = ['org_admin', 'supervisor', 'guard'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Org-level tracking gate.
 * - `shift_gated`: GPS only while the guard is clocked in (default, privacy-safe).
 * - `always_on`: continuous tracking; blocked until a DPIA is recorded.
 */
export const TRACKING_MODES = ['shift_gated', 'always_on'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

/** Allowed breadcrumb retention windows, in days (Art. 5(1)(e) storage limitation). */
export const RETENTION_DAYS = [7, 30, 90] as const;
export type RetentionDays = (typeof RETENTION_DAYS)[number];

/**
 * Selectable trail / heatmap windows, in minutes. Ordered ascending; the client
 * holds the largest (120 min) buffer and trims to a shorter window with no refetch.
 */
export const TIME_WINDOWS = [5, 10, 15, 30, 60, 120] as const;
export type TimeWindow = (typeof TIME_WINDOWS)[number];

/** Lawful basis for processing (default legitimate interest per EDPB employee-consent guidance). */
export const LAWFUL_BASES = ['legitimate_interest', 'consent'] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];
