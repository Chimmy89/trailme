/**
 * Placeholder `Database` type.
 *
 * Stands in for the Supabase-generated schema type until the first migration
 * exists and `supabase gen types typescript` can produce a real one. It is
 * shaped to satisfy `@supabase/supabase-js`'s `createClient<Database>()`
 * generic so the typed client wrapper in `@trailme/supabase-client` compiles
 * before any tables exist.
 *
 * TODO(M1): delete this file once `database.types.ts` is generated; point
 * `index.ts` at the generated file instead.
 */
export type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
