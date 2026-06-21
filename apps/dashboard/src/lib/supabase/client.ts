import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@trailme/db-types";

/**
 * Supabase client for Client Components (browser).
 *
 * Used for interactive auth (email/password sign-in on the login form) and,
 * in later milestones, for subscribing to per-site Realtime position channels.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
