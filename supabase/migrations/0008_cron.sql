-- 0008_cron.sql
-- TrailMe M1 — scheduled maintenance: partition create-ahead, two-tier
-- retention, audit retention, and forgotten-shift auto-close.
--
-- Applies after 0007. pg_cron is installed in 0001. All functions are
-- idempotent so a missed/duplicated run is harmless.
--
-- =====================  RETENTION MODEL — READ CAREFULLY  ===================
-- A daily partition of location_breadcrumbs is SHARED ACROSS ALL ORGS: one
-- partition holds EVERY org''s rows for that UTC day. Retention is per-org
-- (org_settings.retention_days ∈ {7, 30, 90}). Therefore there are TWO distinct
-- jobs, and they must NOT be conflated:
--
--   (a) drop_aged_partitions(): DROP a whole daily partition ONLY when its day
--       is older than the GLOBAL MAX retention (90 days). Dropping earlier would
--       destroy a 90-day org''s still-retained data that lives in the same
--       partition. This is a cheap storage-reclaim OPTIMIZATION layered on top of
--       the guaranteed row purge (b) — it is never the sole deleter, and it never
--       touches the DEFAULT partition.
--
--   (b) purge_expired_breadcrumbs(): ROW-LEVEL DELETE for EVERY tier (7, 30 AND
--       90) of rows older than THAT org''s retention. This is the GUARANTEED
--       deletion path and the retention clock of record. It must cover the 90d
--       tier too: a legitimately old buffered fix (a whole offline shift) is
--       ACCEPTED up to ~90d old and routes to date_trunc('day', captured_at) —
--       but if that daily partition no longer exists (it was already dropped, or
--       was never created because the create-behind horizon is short) the row
--       lands in the DEFAULT partition. drop_aged_partitions NEVER touches
--       DEFAULT, so without a 90d-tier row purge a 90d org''s DEFAULT rows would
--       be retained FOREVER — a GDPR Art. 5(1)(e) storage-limitation violation.
--       Covering all tiers here closes that hole; drop_aged_partitions (a) is
--       then a pure cheap storage-reclaim layered on top, NEVER the sole deleter.
--
-- Net effect: every org''s rows are deleted at THEIR retention by the row purge,
-- regardless of whether they live in a daily partition or DEFAULT; the daily
-- partition they lived in is additionally dropped wholesale once the whole day is
-- past the global max (90d), reclaiming storage cheaply for the long tier.
-- ===========================================================================

-- ===========================================================================
-- ensure_breadcrumb_partitions() — create-ahead AND create-behind daily partitions.
--
-- Creates partitions from (today - p_behind) through (today + p_ahead).
--
--   * p_ahead (default 10): covers clock skew + near-future buffering. 10 days is
--     well past any reasonable device clock skew.
--   * p_behind (default 14): covers the realistic OFFLINE-FLUSH window. The gate
--     admits a buffered fix inside a reconciled shift, and a whole offline shift
--     flushed late should land in a REAL daily partition (so partition pruning
--     works and storage reclaim by drop_aged_partitions applies), not the DEFAULT
--     catch-all. 14 days comfortably covers a device offline for a couple of
--     weeks. Anything older than this still routes to DEFAULT but is GUARANTEED
--     to be retention-purged by purge_expired_breadcrumbs (all tiers) — DEFAULT
--     is never a permanent home for expired data.
--
-- NOTE: p_behind is intentionally << the 90d insane-past accept bound. We do not
-- create 90 partitions behind every night (expensive, mostly empty); instead the
-- row-level purge guarantees retention for the rare very-old fix that lands in
-- DEFAULT. Idempotent: skips existing partitions.
-- ===========================================================================
create or replace function public.ensure_breadcrumb_partitions(
  p_ahead  int default 10,
  p_behind int default 14
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  d          date;
  start_day  date := current_date - p_behind;
  end_day    date := current_date + p_ahead;
  part_name  text;
  v_created  int := 0;
begin
  d := start_day;
  while d < end_day loop
    part_name := format('location_breadcrumbs_%s', to_char(d, 'YYYYMMDD'));
    if to_regclass(format('public.%I', part_name)) is null then
      execute format(
        'create table public.%I partition of public.location_breadcrumbs
           for values from (%L) to (%L)',
        part_name, d::timestamptz, (d + 1)::timestamptz
      );
      v_created := v_created + 1;
    end if;
    d := d + 1;
  end loop;
  return v_created;
end;
$$;

comment on function public.ensure_breadcrumb_partitions(int, int) is
  'Idempotently create daily location_breadcrumbs partitions from (today-p_behind) to (today+p_ahead). create-behind (default 14d) covers the realistic offline-flush window so a late-flushed shift lands in a real daily partition; older fixes route to DEFAULT but are still retention-purged by purge_expired_breadcrumbs.';

-- ===========================================================================
-- drop_aged_partitions() — whole-partition reclaim past the GLOBAL MAX (90d).
--
-- Walks the child partitions of location_breadcrumbs, parses each daily bound
-- from its name, and DROPs (via DROP TABLE, not DETACH) any whose day is entirely
-- older than (today - 90 days). The DEFAULT partition is NEVER dropped. Because
-- the day is past the global max, no live ingest targets it, so the brief
-- ACCESS EXCLUSIVE lock the DROP takes on the parent does not block real writes.
-- (If parent-lock contention ever matters, switch to ALTER TABLE ... DETACH
-- PARTITION CONCURRENTLY then DROP — not needed at current scale.)
-- ===========================================================================
create or replace function public.drop_aged_partitions(
  p_global_max_days int default 90
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec        record;
  v_day      date;
  v_cutoff   date := current_date - p_global_max_days;
  v_dropped  int := 0;
begin
  for rec in
    select c.relname
    from pg_inherits i
    join pg_class c     on c.oid = i.inhrelid
    join pg_class p     on p.oid = i.inhparent
    where p.relname = 'location_breadcrumbs'
      and c.relname ~ '^location_breadcrumbs_[0-9]{8}$'
  loop
    -- parse YYYYMMDD suffix → the day this partition covers [day, day+1).
    v_day := to_date(right(rec.relname, 8), 'YYYYMMDD');
    -- Drop only when the WHOLE day is older than the global-max cutoff, i.e. the
    -- partition''s upper bound (day+1) is <= cutoff so no retained row remains.
    if (v_day + 1) <= v_cutoff then
      execute format('drop table if exists public.%I', rec.relname);
      v_dropped := v_dropped + 1;
    end if;
  end loop;
  return v_dropped;
end;
$$;

comment on function public.drop_aged_partitions(int) is
  'DROP whole daily partitions older than the GLOBAL MAX retention (90d). Never touches the DEFAULT partition or any day a 90-day org still retains.';

-- ===========================================================================
-- purge_expired_breadcrumbs() — GUARANTEED row-level retention purge for EVERY
-- tier (7, 30 AND 90).
--
-- For every org, DELETE rows whose captured_at is older than THAT org's
-- retention_days. Runs as owner (cron) — the firehose has no client DELETE
-- policy, so this privileged path is the only deleter. captured_at (the TRUE
-- event time) is the retention clock, NOT ingested_at, so a late-flushed old fix
-- is purged on its real age.
--
-- WHY ALL TIERS (including 90): an accepted fix up to ~90d old can land in the
-- DEFAULT partition (its daily partition may have been dropped or never created
-- given the create-behind horizon). drop_aged_partitions NEVER touches DEFAULT,
-- so a 90d org's DEFAULT rows older than 90d would otherwise be retained forever
-- (GDPR Art. 5(1)(e) violation). Purging the 90d tier row-wise here closes that
-- hole; the per-org WHERE keeps short-tier co-tenants in the same shared
-- partition unharmed (each org deleted only past ITS own retention).
-- ===========================================================================
create or replace function public.purge_expired_breadcrumbs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  delete from public.location_breadcrumbs b
  using public.org_settings s
  where b.org_id = s.org_id
    and b.captured_at < now() - make_interval(days => s.retention_days);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.purge_expired_breadcrumbs() is
  'Row-level DELETE of breadcrumbs for EVERY org older than THAT org''s retention (7/30/90). The guaranteed retention path: covers the 90d tier so old DEFAULT-partition rows cannot escape retention. Per-org WHERE keeps shared-partition co-tenants unharmed. Uses captured_at (true event time) as the clock.';

-- ===========================================================================
-- purge_aged_audit_log() — audit retention (LONGER than location retention).
-- Audit accountability is kept 2 years (regulatory defensibility window) — well
-- beyond the 90-day location max. The append-only trigger forbids DELETE except
-- when this function flips the trailme.audit_purge session flag, so this is the
-- SOLE legitimate deleter of audit rows.
-- ===========================================================================
create or replace function public.purge_aged_audit_log(
  p_keep_days int default 730
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n bigint;
begin
  -- Authorize the (otherwise forbidden) DELETE for this statement only.
  perform set_config('trailme.audit_purge', 'on', true);  -- local to transaction
  delete from public.audit_log
  where ts < now() - make_interval(days => p_keep_days);
  get diagnostics v_n = row_count;
  perform set_config('trailme.audit_purge', 'off', true);
  return v_n;
end;
$$;

comment on function public.purge_aged_audit_log(int) is
  'Delete audit_log rows older than p_keep_days (default 730 = 2y, longer than location retention). Sole legitimate audit deleter — flips the append-only trigger''s purge flag.';

-- ===========================================================================
-- auto_close_forgotten_shifts() — close shifts left open past max_shift_interval.
-- Sets clock_out = clock_in + max_shift_interval and auto_closed = true, so the
-- gate window for those shifts stops growing and the data stays bounded. An
-- offline real clock-out arriving later cannot reopen (clock_out is set), which
-- is correct: a >16h "shift" was never a real continuous shift.
-- ===========================================================================
create or replace function public.auto_close_forgotten_shifts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.shifts
     set clock_out   = clock_in + public.trailme_max_shift_interval(),
         auto_closed = true
   where clock_out is null
     and clock_in < now() - public.trailme_max_shift_interval();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.auto_close_forgotten_shifts() is
  'Close shifts left open past max_shift_interval (clock_out := clock_in + interval, auto_closed := true). Keeps the gate window bounded.';

-- ===========================================================================
-- Lock down the maintenance functions: cron (postgres) runs them; no app role.
-- ===========================================================================
revoke execute on function public.ensure_breadcrumb_partitions(int, int) from public, anon, authenticated;
revoke execute on function public.drop_aged_partitions(int)               from public, anon, authenticated;
revoke execute on function public.purge_expired_breadcrumbs()             from public, anon, authenticated;
revoke execute on function public.purge_aged_audit_log(int)               from public, anon, authenticated;
revoke execute on function public.auto_close_forgotten_shifts()           from public, anon, authenticated;

-- ===========================================================================
-- Schedule via pg_cron. Idempotent: unschedule a same-named job first so a
-- re-run of this migration does not stack duplicate schedules. All times UTC.
-- ===========================================================================
do $$
declare
  job record;
begin
  for job in
    select jobname from cron.job
    where jobname in (
      'trailme_ensure_partitions',
      'trailme_drop_aged_partitions',
      'trailme_purge_expired_breadcrumbs',
      'trailme_purge_short_retention',  -- legacy name (renamed); unschedule if present
      'trailme_purge_audit_log',
      'trailme_auto_close_shifts'
    )
  loop
    perform cron.unschedule(job.jobname);
  end loop;
end
$$;

-- Create-ahead partitions nightly at 00:10 UTC (before any heavy ingest day).
select cron.schedule(
  'trailme_ensure_partitions',
  '10 0 * * *',
  $$ select public.ensure_breadcrumb_partitions(10, 14); $$
);

-- Guaranteed row-level retention purge (ALL tiers) nightly at 03:00 UTC (off-peak).
select cron.schedule(
  'trailme_purge_expired_breadcrumbs',
  '0 3 * * *',
  $$ select public.purge_expired_breadcrumbs(); $$
);

-- Whole-partition drop past the global max, nightly at 03:30 UTC (after purge).
-- Pure storage-reclaim optimization on top of the guaranteed row purge above.
select cron.schedule(
  'trailme_drop_aged_partitions',
  '30 3 * * *',
  $$ select public.drop_aged_partitions(90); $$
);

-- Audit retention purge weekly (Sundays 04:00 UTC) — far less frequent, 2y window.
select cron.schedule(
  'trailme_purge_audit_log',
  '0 4 * * 0',
  $$ select public.purge_aged_audit_log(730); $$
);

-- Auto-close forgotten shifts every 30 minutes so the gate window never runs
-- away for a guard who forgot to clock out.
select cron.schedule(
  'trailme_auto_close_shifts',
  '*/30 * * * *',
  $$ select public.auto_close_forgotten_shifts(); $$
);
