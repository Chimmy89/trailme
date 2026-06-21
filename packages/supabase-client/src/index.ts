/**
 * @trailme/supabase-client
 *
 * Thin, typed factory wrappers around `@supabase/supabase-js`, each returning a
 * `TrailmeClient` (= `SupabaseClient<Database>`) so callers get end-to-end
 * schema typing for free. Env is passed in explicitly (not read from
 * `process.env`) so the same code runs under Next.js and Expo. Cookie-bound
 * Next.js SSR clients are built in the dashboard app with `@supabase/ssr` (an
 * optional peer dependency here).
 */

export { createAnonClient } from './browser';
export { createServiceClient } from './service';
export { createDeviceIngestClient } from './device';

export type { TrailmeClient, SupabaseEnv } from './client';

// Re-exported so consumers can get the schema type from the client package
// without a separate dependency on @trailme/db-types.
export type { Database } from '@trailme/db-types';
