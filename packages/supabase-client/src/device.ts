import { createClient } from '@supabase/supabase-js';
import type { Database } from '@trailme/db-types';
import type { SupabaseEnv, TrailmeClient } from './client';

/**
 * DEVICE-INGEST client note.
 *
 * The durable breadcrumb flush is performed by transistorsoft's NATIVE HTTP
 * sync, not by JS — it POSTs batches to the `ingest-breadcrumbs` edge function
 * with a STATIC header set (the ~24h device-scoped JWT) while the JS engine may
 * be suspended. That native path therefore does NOT use a supabase-js client at
 * all; it is configured with a plain `Authorization: Bearer <deviceToken>`
 * header on the SDK's `url`/`headers` options (see the mobile TrackingService
 * in M2). This file exists so server/tooling code that needs to act AS a device
 * (tests, the relay, reconciliation jobs) can build a client carrying the same
 * device-token claims without the interactive-session refresh machinery.
 *
 * The token is treated as static: no session persistence, no auto-refresh — the
 * device token is minted server-side and rotated by re-minting, never refreshed
 * through the auth client.
 */
export function createDeviceIngestClient(env: SupabaseEnv, deviceToken: string): TrailmeClient {
  return createClient<Database>(env.url, env.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: { Authorization: `Bearer ${deviceToken}` },
    },
  });
}
