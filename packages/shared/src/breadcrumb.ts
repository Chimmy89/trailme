import { z } from 'zod';

/**
 * Reusable coordinate fragments. WGS84 (EPSG:4326) degrees.
 */
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

/**
 * BREADCRUMB DTO — one durable GPS fix as posted by the native sync to the
 * ingest Edge Function. This is the wire shape; the server preserves
 * `capturedAt` verbatim (Art. 5(1)(d) accuracy) and derives partition routing
 * separately, and dedups on `(guardId, clientSeq)`.
 *
 * - `capturedAt` is the TRUE device event time as an ISO-8601 string; it is
 *   never rewritten. Legitimately-old buffered fixes (a full offline shift)
 *   keep their real time.
 * - `clientSeq` is a monotonic per-INSTALL counter. It resets to 0 on app
 *   reinstall / local-DB wipe, so `(guardId, clientSeq)` alone is NOT a stable
 *   idempotency key across reinstalls (a fresh install re-emits 1,2,3… that
 *   would collide with the prior install's already-ingested seqs for the same
 *   guard and be wrongly dropped as duplicates). The stable key is therefore
 *   `(guardId, installId, clientSeq)`: `installId` is a per-install UUID the
 *   client generates once and persists for the life of the install, scoping the
 *   counter to one install epoch. A clamped replay within the same install still
 *   collides (idempotent); a reinstall gets a fresh `installId` so its genuinely
 *   new fixes are no longer mistaken for duplicates.
 * - `accuracyM` is horizontal accuracy in metres; the server drops/flags fixes
 *   worse than ~50 m.
 * - `isKeepalive` marks the 2-min stationary heartbeat; keepalives are excluded
 *   from the heatmap so a parked guard makes no false hotspot.
 */
export const BreadcrumbSchema = z.object({
  guardId: z.string().uuid(),
  // Per-install UUID generated once on the device and persisted for the install's
  // life. Scopes clientSeq to one install epoch so a reinstall (which resets
  // clientSeq) cannot collide with the prior install's ingested rows.
  installId: z.string().uuid(),
  lat: latitude,
  lon: longitude,
  capturedAt: z.string().datetime({ offset: true }),
  clientSeq: z.number().int().nonnegative(),
  accuracyM: z.number().nonnegative(),
  isKeepalive: z.boolean(),
});
export type Breadcrumb = z.infer<typeof BreadcrumbSchema>;

/**
 * A batch of breadcrumbs as flushed from the device's local SQLite queue.
 * Bounded so a single oversized POST can't blow the ingest function's budget;
 * the queue flushes in small batches (~5–12 fixes).
 */
export const BreadcrumbBatchSchema = z.object({
  breadcrumbs: z.array(BreadcrumbSchema).min(1).max(500),
});
export type BreadcrumbBatch = z.infer<typeof BreadcrumbBatchSchema>;

/** Why the ingest function rejected a single breadcrumb (no silent loss). */
export const BREADCRUMB_REJECT_REASONS = [
  'low_accuracy',
  'stuck_last_known',
  'off_shift_gate',
  'captured_at_insane',
  'duplicate',
  'unparseable',
  // Security-relevant: the server's membership re-verify rejected this row
  // (forged/stale org/site claim, or an inactive guard). Distinct from a benign
  // off-shift fix so alerting can tell a forgery attempt from a normal gate miss.
  'forged_or_inactive',
  // An unexpected INSERT failure (not a parse error, not a gate/dedup decision).
  // Kept distinct from 'unparseable' so the client report and the dead-letter
  // reason agree and a real server fault is visible.
  'insert_error',
] as const;
export type BreadcrumbRejectReason = (typeof BREADCRUMB_REJECT_REASONS)[number];

/**
 * PER-BATCH ingest result. The client deletes from its local queue only after a
 * 200 confirming persistence of the kept rows; rejected rows carry a reason so
 * loss is observable and gate-rejected rows can be retried/reconciled.
 */
export const BreadcrumbIngestResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.array(
    z.object({
      clientSeq: z.number().int().nonnegative(),
      reason: z.enum(BREADCRUMB_REJECT_REASONS),
    }),
  ),
});
export type BreadcrumbIngestResult = z.infer<typeof BreadcrumbIngestResultSchema>;
