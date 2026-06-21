-- 03_accuracy_filter_test.sql
-- VERIFY: accuracy filter. A >50m fix is flagged is_low_confidence and is
-- EXCLUDED from a heatmap-style read (trail_window excludes low-confidence).
--
-- The edge function sets is_low_confidence for >50m fixes; here we exercise the
-- DB contract directly by inserting one good and one low-confidence fix through
-- the RPC and confirming trail_window omits the low-confidence one.

begin;
select plan(3);

\i supabase/tests/00_helpers.sql

-- Make guard A''s membership query-able as the caller for trail_window: the RPC
-- uses auth.uid(). We impersonate the supervisor/admin (admin A sees all sites).
-- pgTAP runs as the migration role; set the request claims so auth.uid() resolves.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text,
  true);

-- Insert a good fix (8m) and a low-confidence fix (75m, pre-flagged as the edge
-- function would). Both inside the open shift window.
set local role postgres;
with batch as (
  select jsonb_build_array(
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9139, 'lon', 10.7522,
      'captured_at', (now() - interval '2 minutes')::text,
      'client_seq', 3001, 'accuracy_m', 8.0,
      'is_keepalive', false, 'is_low_confidence', false
    ),
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9200, 'lon', 10.7600,
      'captured_at', (now() - interval '1 minute')::text,
      'client_seq', 3002, 'accuracy_m', 75.0,
      'is_keepalive', false, 'is_low_confidence', true
    )
  ) as rows
)
select is(
  (public.batch_insert_breadcrumbs((select rows from batch)) ->> 'accepted')::int,
  2,
  'both fixes accepted (low-confidence is retained, not dropped)'
);

-- The low-confidence row IS stored (accountability) — proves "not silently dropped".
select is(
  (select is_low_confidence from public.location_breadcrumbs where client_seq = 3002),
  true,
  'the >50m fix is stored flagged is_low_confidence (kept for accountability)'
);

-- Heatmap-style read via trail_window EXCLUDES the low-confidence point.
set local role authenticated;
select is(
  (select count(*)::int from public.trail_window(
     '00000000-0000-0000-0000-0000000000b1'::uuid, 60)
   where captured_at >= now() - interval '5 minutes'),
  1,
  'trail_window returns only the good fix; the >50m one is excluded'
);

select * from finish();
rollback;
