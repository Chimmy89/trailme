-- 07_security_test.sql
-- VERIFY the security invariants:
--   * custom_access_token_hook never elevates role (a guard stays a guard).
--   * a cross-org SELECT on location_breadcrumbs returns 0 rows (RLS isolation).
--   * a device token for org A cannot insert rows for org B (the RPC re-verify
--     rejects a row whose guard is not an active member of that org/site).

begin;
select plan(8);

\i supabase/tests/00_helpers.sql

-- ===========================================================================
-- (1) custom_access_token_hook never elevates role.
-- Feed the hook a guard''s event and assert app_metadata.role == 'guard'.
-- ===========================================================================
select is(
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', '00000000-0000-0000-0000-0000000000c2',
     'claims', jsonb_build_object('app_metadata', jsonb_build_object('role', 'org_admin'))
   )) #>> '{claims,app_metadata,role}'),
  'guard',
  'hook stamps role=guard from membership, ignoring an attacker-supplied org_admin claim'
);

select is(
  (public.custom_access_token_hook(jsonb_build_object(
     'user_id', '00000000-0000-0000-0000-0000000000c2',
     'claims', jsonb_build_object('app_metadata', '{}'::jsonb)
   )) #>> '{claims,app_metadata,org_id}'),
  '00000000-0000-0000-0000-0000000000a1',
  'hook stamps the guard''s real org_id'
);

-- ===========================================================================
-- (2) cross-org SELECT on location_breadcrumbs returns 0 rows.
-- Insert a row for org A, then read as a Beta (org B) guard.
-- ===========================================================================
-- Insert one fix for guard A (in-window) as the privileged migration role.
select public.batch_insert_breadcrumbs(jsonb_build_array(
  jsonb_build_object(
    'guard_id','00000000-0000-0000-0000-0000000000c2','install_id','00000000-0000-0000-0000-0000000000d1','org_id','00000000-0000-0000-0000-0000000000a1',
    'site_id','00000000-0000-0000-0000-0000000000b1','lat',59.91,'lon',10.75,
    'captured_at',(now())::text,'client_seq',7001,'accuracy_m',5.0,
    'is_keepalive',false,'is_low_confidence',false)
));

-- Confirm it exists (privileged view).
select is(
  (select count(*)::int from public.location_breadcrumbs where client_seq = 7001),
  1,
  'org A row exists (privileged read)'
);

-- Now read as Beta''s guard (org B). RLS must hide org A''s row.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c3', 'role', 'authenticated')::text,
  true);

select is(
  (select count(*)::int from public.location_breadcrumbs where client_seq = 7001),
  0,
  'cross-org SELECT returns 0 rows (org B cannot see org A''s breadcrumb)'
);

-- ===========================================================================
-- (3) A device token for org A cannot insert rows for org B. The RPC re-verify
-- rejects a row whose claimed org/site does not match the guard''s membership.
-- Here: guard A (member of org A) row but with org_id/site_id of org B → reject.
-- ===========================================================================
set local role postgres;
with res as (
  select public.batch_insert_breadcrumbs(jsonb_build_array(
    jsonb_build_object(
      'guard_id','00000000-0000-0000-0000-0000000000c2',          -- guard A
      'install_id','00000000-0000-0000-0000-0000000000d1',
      'org_id','00000000-0000-0000-0000-0000000000a2',            -- forged: org B
      'site_id','00000000-0000-0000-0000-0000000000b2',           -- forged: site B
      'lat',60.0,'lon',11.0,'captured_at',(now())::text,
      'client_seq',7002,'accuracy_m',5.0,'is_keepalive',false,'is_low_confidence',false)
  )) as report
)
select is(
  (select (report ->> 'accepted')::int from res),
  0,
  'forged cross-org row (guard A claiming org B) is NOT accepted'
);

select is(
  (select count(*)::int from public.location_breadcrumbs where client_seq = 7002),
  0,
  'forged cross-org row is NOT inserted (RPC membership re-verify rejected it)'
);

-- The rejection is reported with the DISTINCT security reason 'forged_or_inactive'
-- (not mislabeled as a benign 'off_shift_gate'), so alerting can see the forgery.
with res as (
  select public.batch_insert_breadcrumbs(jsonb_build_array(
    jsonb_build_object(
      'guard_id','00000000-0000-0000-0000-0000000000c2',          -- guard A
      'install_id','00000000-0000-0000-0000-0000000000d1',
      'org_id','00000000-0000-0000-0000-0000000000a2',            -- forged: org B
      'site_id','00000000-0000-0000-0000-0000000000b2',           -- forged: site B
      'lat',60.0,'lon',11.0,'captured_at',(now())::text,
      'client_seq',7003,'accuracy_m',5.0,'is_keepalive',false,'is_low_confidence',false)
  )) as report
)
select is(
  (select (report -> 'rejected' -> 0 ->> 'reason') from res),
  'forged_or_inactive',
  'forged cross-org row is reported with the distinct security reason (not off_shift_gate)'
);

-- ===========================================================================
-- (4) trail reads require a LIVE membership — never the service key. A caller
-- with no auth.uid() / no active membership (authz.org_id() -> NULL) must RAISE,
-- not return rows. This locks the "reads can never be done with the service key
-- bypassing accountability" invariant by test rather than incidental behavior.
-- We are running as `postgres` here with no request.jwt.claims set, so auth.uid()
-- is NULL → trail_window must raise 'no active membership'.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims', NULL, true);
select throws_ok(
  $$ select * from public.trail_window('00000000-0000-0000-0000-0000000000b1'::uuid, 30) $$,
  'P0001',
  NULL,
  'trail_window with no live membership raises (service-key / no-auth caller cannot read trails)'
);

select * from finish();
rollback;
