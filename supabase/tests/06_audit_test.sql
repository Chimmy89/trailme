-- 06_audit_test.sql
-- VERIFY: a trail_window call writes a trail_window_read audit_log row; the
-- audit_log is append-only (UPDATE/DELETE forbidden); and a settings_change
-- writes an audit row.

begin;
select plan(5);

\i supabase/tests/00_helpers.sql

-- Impersonate admin A (sees all org sites) so trail_window passes has_site_access.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text,
  true);

-- Baseline audit count for this org.
-- (Run trail_window; it must write exactly one trail_window_read row.)
select lives_ok(
  $$ select * from public.trail_window('00000000-0000-0000-0000-0000000000b1'::uuid, 30) $$,
  'trail_window executes for an authorized reader'
);

set local role postgres;
select is(
  (select count(*)::int from public.audit_log
   where org_id = '00000000-0000-0000-0000-0000000000a1'
     and action = 'trail_window_read'
     and actor_user_id = '00000000-0000-0000-0000-0000000000c1'
     and (params ->> 'site_id') = '00000000-0000-0000-0000-0000000000b1'
     and (params ->> 'minutes') = '30'),
  1,
  'trail_window wrote exactly one trail_window_read audit row (who watched whom)'
);

-- Append-only: UPDATE is forbidden.
select throws_ok(
  $$ update public.audit_log set action = 'erasure'
     where org_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'P0001',
  NULL,
  'audit_log UPDATE is forbidden (append-only trigger)'
);

-- Append-only: ad-hoc DELETE is forbidden (the purge flag is not set).
select throws_ok(
  $$ delete from public.audit_log
     where org_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'P0001',
  NULL,
  'audit_log DELETE is forbidden outside the retention purge'
);

-- settings_change trigger: changing retention writes a settings_change row.
update public.org_settings set retention_days = 90
  where org_id = '00000000-0000-0000-0000-0000000000a1';

select is(
  (select count(*)::int from public.audit_log
   where org_id = '00000000-0000-0000-0000-0000000000a1'
     and action = 'settings_change'),
  1,
  'org_settings change wrote a settings_change audit row'
);

select * from finish();
rollback;
