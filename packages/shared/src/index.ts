/**
 * @trailme/shared
 *
 * Pure-TypeScript contract types shared by the dashboard, the mobile app, and
 * the edge functions: closed enums (roles, tracking mode, retention, time
 * windows), the realtime channel-name helper, zod schemas + inferred types for
 * the breadcrumb DTO and the consolidated positions broadcast, the device-token
 * claim shape, and small runtime guards. Its only dependency is `zod`.
 */

export {
  ROLES,
  TRACKING_MODES,
  RETENTION_DAYS,
  TIME_WINDOWS,
  LAWFUL_BASES,
  type Role,
  type TrackingMode,
  type RetentionDays,
  type TimeWindow,
  type LawfulBasis,
} from './enums';

export { SITE_CHANNEL_PREFIX, channelName } from './realtime';

export {
  BreadcrumbSchema,
  BreadcrumbBatchSchema,
  BreadcrumbIngestResultSchema,
  BREADCRUMB_REJECT_REASONS,
  type Breadcrumb,
  type BreadcrumbBatch,
  type BreadcrumbIngestResult,
  type BreadcrumbRejectReason,
} from './breadcrumb';

export {
  PositionSchema,
  PositionsBroadcastSchema,
  POSITIONS_BROADCAST_EVENT,
  type Position,
  type PositionsBroadcast,
} from './positions';

export {
  DEVICE_TOKEN_KIND,
  DeviceTokenClaimsSchema,
  type DeviceTokenClaims,
} from './device-token';

export {
  isRole,
  isTrackingMode,
  isRetentionDays,
  isTimeWindow,
  assertNever,
} from './guards';
