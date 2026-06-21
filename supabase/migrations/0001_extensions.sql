-- 0001_extensions.sql
-- TrailMe M0 — extensions + private schemas.
--
-- Applies first on a fresh Postgres 15 + PostGIS instance. Idempotent: safe to
-- re-run (CREATE EXTENSION / SCHEMA ... IF NOT EXISTS).
--
-- Supabase convention: non-core extensions live in the dedicated `extensions`
-- schema (already present on a Supabase project) rather than `public`, so the
-- Data API surface stays clean.

-- ---------------------------------------------------------------------------
-- PostGIS — geography(Point/Polygon, 4326) for site geofences (M0) and the
-- breadcrumb firehose / spatial indexes (M1+).
-- ---------------------------------------------------------------------------
create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- pg_cron — in-database scheduler. Not USED until M1 (create-ahead partitions,
-- retention purges, auto-close forgotten shifts), but installed now so the
-- extension is present and the M1 migration only has to schedule jobs.
-- NOTE: pg_cron must be installed into the `pg_catalog`-adjacent default; on
-- Supabase it is created in the `pg_catalog`/`extensions` space and its
-- bookkeeping lives in the `cron` schema. The `cron` schema is created by the
-- extension itself.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- Time-ordered UUIDs for the high-insert breadcrumb / checkpoint PKs (M1+).
-- Prefer pg_uuidv7 (true UUIDv7). If the image does not ship it, fall back to
-- pgcrypto's gen_random_uuid() at the call site — pgcrypto is always available
-- on Supabase. We install pgcrypto unconditionally (low-volume dimension PKs
-- already use gen_random_uuid()) and attempt pg_uuidv7 best-effort.
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  -- pg_uuidv7 provides uuid_generate_v7(); used by breadcrumbs/checkpoints in M1.
  -- If the extension is unavailable on this image, M1 falls back to
  -- gen_random_uuid() (pgcrypto). We do not fail the migration on its absence.
  create extension if not exists pg_uuidv7 with schema extensions;
exception
  when undefined_file or feature_not_supported or insufficient_privilege then
    raise notice 'pg_uuidv7 unavailable on this image; M1 will fall back to gen_random_uuid()';
end
$$;

-- ---------------------------------------------------------------------------
-- Private `authz` schema — home of the STABLE SECURITY DEFINER helpers
-- (authz.org_id(), authz.has_role(), authz.has_site_access()) used by RLS
-- policies in 0003. Kept OUT of the exposed API schema list (see config.toml)
-- so security-definer functions are never reachable through the Data API.
-- ---------------------------------------------------------------------------
create schema if not exists authz;

comment on schema authz is
  'Private schema for SECURITY DEFINER authorization helpers consumed by RLS. Not exposed via the Data API.';

-- Lock the schema down: only the database owner / postgres builds objects here;
-- application roles get EXECUTE on individual functions explicitly in 0003.
revoke all on schema authz from public;
grant usage on schema authz to authenticated, anon, service_role;
