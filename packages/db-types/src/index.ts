/**
 * @trailme/db-types
 *
 * Single source of truth for the generated Supabase `Database` type.
 *
 * This file re-exports whatever the Supabase CLI generated into
 * `database.types.ts`. Until the first migration lands (M1), no generated
 * file exists, so we ship a minimal placeholder below and re-export it.
 *
 * Regenerate after every migration with:
 *
 *   supabase gen types typescript --linked > packages/db-types/src/database.types.ts
 *
 * Then switch the re-export below to point at `./database.types`.
 */

// TODO(M1): replace this placeholder with a re-export of the generated file:
//   export type { Database } from './database.types';
export type { Database } from './placeholder';
