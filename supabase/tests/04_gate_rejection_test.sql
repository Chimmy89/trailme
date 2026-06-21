-- 04_gate_rejection_test.sql
-- VERIFY: gate rejection is observable, never silent. A batch with an off-shift
-- row returns a reason in the report AND the raw row lands in
-- dead_letter_breadcrumbs (not silently dropped).

begin;
select plan(4);

\i supabase/tests/00_helpers.sql

-- guard A''s open shift starts 2h ago. A fix captured 5 HOURS ago is OUTSIDE the
-- shift window → the gate rejects it. A second fix (now, in-window) is accepted,
-- proving the rejection is per-row, not whole-batch.
with batch as (
  select jsonb_build_array(
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9139, 'lon', 10.7522,
      'captured_at', (now() - interval '5 hours')::text,
      'client_seq', 4001, 'accuracy_m', 9.0,
      'is_keepalive', false, 'is_low_confidence', false
    ),
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9140, 'lon', 10.7523,
      'captured_at', (now())::text,
      'client_seq', 4002, 'accuracy_m', 5.0,
      'is_keepalive', false, 'is_low_confidence', false
    )
  ) as rows
),
res as (
  select public.batch_insert_breadcrumbs((select rows from batch)) as report
)
select is(
  (select (report ->> 'accepted')::int from res),
  1,
  'one in-window row accepted, one off-shift row not (per-row gate)'
);

-- The off-shift row is recorded in dead_letter_breadcrumbs with its reason.
select is(
  (select reason from public.dead_letter_breadcrumbs
   where client_seq = 4001 limit 1),
  'off_shift_gate',
  'the off-shift row is recorded in dead_letter_breadcrumbs with reason off_shift_gate'
);

-- The off-shift row did NOT land in location_breadcrumbs.
select is(
  (select count(*)::int from public.location_breadcrumbs where client_seq = 4001),
  0,
  'off-shift row is NOT inserted into the firehose'
);

-- The in-window row DID land.
select is(
  (select count(*)::int from public.location_breadcrumbs where client_seq = 4002),
  1,
  'in-window row IS inserted'
);

select * from finish();
rollback;
