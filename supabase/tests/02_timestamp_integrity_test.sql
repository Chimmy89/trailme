-- 02_timestamp_integrity_test.sql
-- VERIFY: timestamp integrity. A 50-min-old buffered fix keeps its TRUE
-- captured_at (NOT clamped to now) and lands in the correct daily partition.

begin;
select plan(5);

\i supabase/tests/00_helpers.sql

-- A legitimately-old buffered fix: captured 50 minutes ago. The open shift in
-- the helper starts 2h ago, so the gate admits it.
with batch as (
  select jsonb_build_array(
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9139, 'lon', 10.7522,
      'captured_at', (now() - interval '50 minutes')::text,
      'client_seq', 2001, 'accuracy_m', 7.0,
      'is_keepalive', false, 'is_low_confidence', false
    )
  ) as rows
)
select is(
  (public.batch_insert_breadcrumbs((select rows from batch)) ->> 'accepted')::int,
  1,
  '50-min-old buffered fix accepted'
);

-- captured_at preserved: ~50 min old, NOT rewritten to ~now.
select cmp_ok(
  (select captured_at from public.location_breadcrumbs where client_seq = 2001),
  '<',
  now() - interval '40 minutes',
  'captured_at preserved (still clearly in the past, not clamped to now)'
);

select cmp_ok(
  (select captured_at from public.location_breadcrumbs where client_seq = 2001),
  '>',
  now() - interval '60 minutes',
  'captured_at preserved (not pushed further back either)'
);

-- partition_ts buckets to the captured day → the row lives in its captured-day
-- daily partition (50 min ago is the same UTC day in all but a midnight edge).
select is(
  (select date_trunc('day', captured_at) = partition_ts
   from public.location_breadcrumbs where client_seq = 2001),
  true,
  'partition_ts is the captured day (routed by true event time, not ingest time)'
);

-- Crucially: assert the row physically lives in its DAILY partition, NOT the
-- DEFAULT catch-all. Checking the column value alone would pass even if the row
-- fell into location_breadcrumbs_default; tableoid proves the actual child table.
-- Derive the expected name from the row''s own partition_ts (midnight-edge safe).
select is(
  (select tableoid::regclass::text from public.location_breadcrumbs where client_seq = 2001),
  (select 'location_breadcrumbs_' || to_char(partition_ts, 'YYYYMMDD')
     from public.location_breadcrumbs where client_seq = 2001),
  'row lives in its daily partition, not the DEFAULT partition'
);

select * from finish();
rollback;
