/**
 * @trailme/db-types
 *
 * Single source of truth for the generated Supabase `Database` type.
 *
 * This file re-exports the type the Supabase CLI generated into
 * `database.types.ts`. Regenerate after every migration with:
 *
 *   supabase gen types typescript --linked > packages/db-types/src/database.types.ts
 */

export type { Database } from './database.types';
