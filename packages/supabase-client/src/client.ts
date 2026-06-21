import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@trailme/db-types';

/**
 * The project-wide typed Supabase client alias. Every factory in this package
 * returns this so callers get end-to-end schema typing from `@trailme/db-types`
 * without re-specifying the `Database` generic at each call site.
 */
export type TrailmeClient = SupabaseClient<Database>;

/** Minimal connection inputs every factory needs. Passed in explicitly rather
 * than read from `process.env` so the same code runs under Next.js and Expo,
 * which expose env under different prefixes (`NEXT_PUBLIC_*` vs `EXPO_PUBLIC_*`).
 */
export interface SupabaseEnv {
  url: string;
  /** Anon (publishable) key for browser/app clients, or the service-role key
   * for the server factory — the factory decides which is appropriate. */
  key: string;
}
