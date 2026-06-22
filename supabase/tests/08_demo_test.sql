-- 08_demo_test.sql
-- VERIFY the demo-mode RPCs (migration 0009) that the live browser demo depends
-- on. These ship in the same migration stream as the real schema and are granted
-- to every authenticated user, so the cross-org isolation of demo_live_map is the
-- one invariant that MUST hold when a demo runs against a shared hosted DB:
--   * demo_push_position writes a breadcrumb + an online guard_positions row,
--     scoped to the caller's own org.
--   * demo_live_map returns ONLY the caller's org — org B never leaks to org A
--     (and vice-versa), even though both are authenticated members.
--   * demo_live_map with no org context (no auth / service-key caller) RAISES,
--     so it can never be read without accountability.
--
-- Uses the same fixtures as the rest of the suite (see 00_helpers.sql):
--   org A / guard A = ...a1 / ...c2     org B / guard B = ...a2 / ...c3

begin;
select plan(6);

\i supabase/tests/00_helpers.sql

-- ===========================================================================
-- (1) demo_push_position as guard A writes for guard A's own org.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text,
  true);
select public.demo_push_position(59.913, 10.752);

-- Inspect as the privileged role (RLS off) to confirm what landed.
set local role postgres;
select set_config('request.jwt.claims', NULL, true);

select is(
  (select online::int from public.guard_positions
     where guard_id = '00000000-0000-0000-0000-0000000000c2'),
  1,
  'demo_push_position upserts an online guard_positions row for the caller'
);

select is(
  (select count(*)::int from public.location_breadcrumbs
     where guard_id = '00000000-0000-0000-0000-0000000000c2'
       and org_id = '00000000-0000-0000-0000-0000000000a1'
       and captured_at >= now() - interval '2 minutes'),
  1,
  'demo_push_position inserts exactly one in-window breadcrumb in the caller''s own org'
);

-- ===========================================================================
-- (2) guard B (org B) also pushes; demo_live_map must keep the orgs apart.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c3', 'role', 'authenticated')::text,
  true);
select public.demo_push_position(60.100, 11.100);

-- As guard A: sees own org point, never org B's.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.demo_live_map(60)
     where guard_id = '00000000-0000-0000-0000-0000000000c2'),
  1,
  'demo_live_map returns the caller''s own org point'
);

select is(
  (select count(*)::int from public.demo_live_map(60)
     where guard_id = '00000000-0000-0000-0000-0000000000c3'),
  0,
  'demo_live_map does NOT leak org B''s guard to an org A caller (cross-org isolation)'
);

-- ===========================================================================
-- (3) Reverse direction: org B caller can never see org A.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c3', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.demo_live_map(60)
     where guard_id = '00000000-0000-0000-0000-0000000000c2'),
  0,
  'org B caller cannot see org A''s guard (reverse cross-org isolation)'
);

-- ===========================================================================
-- (4) No org context (service-key / no-auth caller) must raise, not return rows.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims', NULL, true);

select throws_ok(
  $$ select * from public.demo_live_map(60) $$,
  'P0001',
  NULL,
  'demo_live_map with no active membership raises (cannot be read without an org context)'
);

select * from finish();
rollback;
