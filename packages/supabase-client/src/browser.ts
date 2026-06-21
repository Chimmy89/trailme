import { createClient } from '@supabase/supabase-js';
import type { Database } from '@trailme/db-types';
import type { SupabaseEnv, TrailmeClient } from './client';

/**
 * Anon client factory for interactive use — the browser (dashboard) and the
 * Expo app. Backed by the publishable anon key, so every read/write is subject
 * to RLS under the signed-in user's 1h interactive session. Realtime is enabled
 * here because the live per-site position channel rides this client.
 *
 * Pass env explicitly:
 *   dashboard → NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   mobile    → EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY
 *
 * NOTE: cookie-bound SSR clients (Next.js server components / route handlers)
 * are built in the dashboard app with `@supabase/ssr` (a peer dep here) because
 * they need framework-specific cookie adapters. This factory is for the
 * browser/app runtime where a single long-lived client is correct.
 */
export function createAnonClient(env: SupabaseEnv): TrailmeClient {
  return createClient<Database>(env.url, env.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
