import { createClient } from '@supabase/supabase-js';
import type { Database } from '@trailme/db-types';
import type { SupabaseEnv, TrailmeClient } from './client';

/**
 * SERVER-ONLY service-role client factory. The service-role key BYPASSES RLS,
 * so this must never reach a browser bundle. Two guards enforce that:
 *
 *  1. A runtime check throws if a `window` global is present (i.e. the module
 *     was bundled into client code) — a loud failure beats a silent key leak.
 *  2. Callers should import this from server-only entrypoints
 *     (Next.js route handlers / server actions, edge functions). On the
 *     dashboard, keep it behind `import 'server-only'` in the consuming module.
 *
 * Use only for trusted server work (edge functions, admin RPCs). Session
 * persistence and token refresh are disabled — there is no user session here.
 *
 * Pass env explicitly: url = SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL),
 * key = SUPABASE_SERVICE_ROLE_KEY.
 */
export function createServiceClient(env: SupabaseEnv): TrailmeClient {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[@trailme/supabase-client] createServiceClient() was called in a browser ' +
        'context. The service-role key bypasses RLS and must never be bundled to ' +
        'the client. Import this only from server-only code.',
    );
  }

  return createClient<Database>(env.url, env.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
