import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@trailme/db-types";

/**
 * Supabase client for React Server Components, Server Actions, and Route Handlers.
 *
 * Reads and writes the auth session through Next's cookie store. In a Server
 * Component the cookie store is read-only, so `setAll` is wrapped in try/catch:
 * session refresh there is a no-op and is instead handled by `middleware.ts`.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session, so this can be safely ignored.
          }
        },
      },
    },
  );
}
