-- 01_idempotent_replay_test.sql
-- VERIFY: idempotent replay. Two posted batches — the second a deliberate replay
-- of the first — produce exactly ONE set of rows. Proves the ingest dedup on
-- (guard_id, install_id, client_seq) via batch_insert_breadcrumbs, AND that a
-- reinstall (same client_seq under a new install_id) is NOT falsely deduped.

begin;
select plan(6);

\i supabase/tests/00_helpers.sql

-- A batch of two fixes for guard A, captured ~just now (inside the open shift).
-- client_seq 1001 + 1002.
with batch as (
  select jsonb_build_array(
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9139, 'lon', 10.7522,
      'captured_at', (now() - interval '1 minute')::text,
      'client_seq', 1001, 'accuracy_m', 8.0,
      'is_keepalive', false, 'is_low_confidence', false
    ),
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9140, 'lon', 10.7523,
      'captured_at', (now())::text,
      'client_seq', 1002, 'accuracy_m', 6.0,
      'is_keepalive', false, 'is_low_confidence', false
    )
  ) as rows
)
select is(
  (public.batch_insert_breadcrumbs((select rows from batch)) ->> 'accepted')::int,
  2,
  'first batch: both fresh rows accepted'
);

-- Exactly 2 rows for seqs 1001/1002 after the first batch.
select is(
  (select count(*)::int from public.location_breadcrumbs
   where guard_id = '00000000-0000-0000-0000-0000000000c2'
     and client_seq in (1001, 1002)),
  2,
  'two rows persisted after first batch'
);

-- Replay the IDENTICAL batch (same client_seqs).
with batch as (
  select jsonb_build_array(
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9139, 'lon', 10.7522,
      'captured_at', (now() - interval '1 minute')::text,
      'client_seq', 1001, 'accuracy_m', 8.0,
      'is_keepalive', false, 'is_low_confidence', false
    ),
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9140, 'lon', 10.7523,
      'captured_at', (now())::text,
      'client_seq', 1002, 'accuracy_m', 6.0,
      'is_keepalive', false, 'is_low_confidence', false
    )
  ) as rows
)
select is(
  (public.batch_insert_breadcrumbs((select rows from batch)) ->> 'accepted')::int,
  0,
  'replay batch: zero accepted (all deduped)'
);

-- Still exactly 2 rows — the replay added nothing.
select is(
  (select count(*)::int from public.location_breadcrumbs
   where guard_id = '00000000-0000-0000-0000-0000000000c2'
     and client_seq in (1001, 1002)),
  2,
  'still exactly two rows after replay (idempotent)'
);

-- The replay report carries a per-row 'duplicate' reason — loss is observable.
with batch as (
  select jsonb_build_array(
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d1',
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9139, 'lon', 10.7522,
      'captured_at', (now() - interval '1 minute')::text,
      'client_seq', 1001, 'accuracy_m', 8.0,
      'is_keepalive', false, 'is_low_confidence', false
    )
  ) as rows
)
select is(
  (public.batch_insert_breadcrumbs((select rows from batch))
     -> 'rejected' -> 0 ->> 'reason'),
  'duplicate',
  'replay reports a per-row duplicate reason (no silent loss)'
);

-- REINSTALL EPOCH: the SAME guard + SAME client_seq (1001) but a DIFFERENT
-- install_id (a fresh install whose counter reset) must NOT be treated as a
-- duplicate — these are genuinely new fixes. Proves install_id scopes the dedup
-- key so a reinstall does not silently drop data.
with batch as (
  select jsonb_build_array(
    jsonb_build_object(
      'guard_id', '00000000-0000-0000-0000-0000000000c2',
      'install_id', '00000000-0000-0000-0000-0000000000d2',   -- NEW install epoch
      'org_id',   '00000000-0000-0000-0000-0000000000a1',
      'site_id',  '00000000-0000-0000-0000-0000000000b1',
      'lat', 59.9139, 'lon', 10.7522,
      'captured_at', (now() - interval '1 minute')::text,
      'client_seq', 1001, 'accuracy_m', 8.0,                  -- same seq as before
      'is_keepalive', false, 'is_low_confidence', false
    )
  ) as rows
)
select is(
  (public.batch_insert_breadcrumbs((select rows from batch)) ->> 'accepted')::int,
  1,
  'same client_seq under a NEW install_id is accepted (reinstall is not falsely deduped)'
);

select * from finish();
rollback;
