/**
 * Session-derived identity for the field app.
 *
 * The interactive Supabase session's access token carries `app_metadata`
 * stamped by the Custom Access Token Hook (org_id / role / site_ids — see
 * supabase/migrations/0004). These are the constant-time authorization claims;
 * the screens resolve org/site scope from them. `guardId` is the auth user id.
 *
 * NOTE: these claims are a fast-path hint only. Every sensitive server path
 * (ingest RPC, trail_window, realtime channel join) RE-VERIFIES org/site
 * against LIVE membership, so a stale claim cannot read another tenant's data.
 */
import type { Session } from '@supabase/supabase-js';
import { isRole, type Role } from '@trailme/shared';

export interface GuardIdentity {
  /** auth.users.id — the guard's id used everywhere as guard_id. */
  guardId: string;
  orgId: string;
  role: Role;
  /** Sites the guard is assigned to (fast-path hint; re-checked server-side). */
  siteIds: string[];
}

/** Shape of the claims the access-token hook writes into app_metadata. */
interface AppMetadata {
  org_id?: unknown;
  role?: unknown;
  site_ids?: unknown;
}

/**
 * Reads {@link GuardIdentity} from a session, or null when the session has no
 * authorization claims (no active membership → the hook stamps nothing, RLS
 * denies). Callers treat null as "not provisioned; cannot track".
 */
export function identityFromSession(session: Session | null): GuardIdentity | null {
  if (!session?.user) return null;

  const meta = (session.user.app_metadata ?? {}) as AppMetadata;
  const orgId = typeof meta.org_id === 'string' ? meta.org_id : null;
  const role = isRole(meta.role) ? meta.role : null;
  if (!orgId || !role) return null;

  const siteIds = Array.isArray(meta.site_ids)
    ? meta.site_ids.filter((s): s is string => typeof s === 'string')
    : [];

  return { guardId: session.user.id, orgId, role, siteIds };
}
