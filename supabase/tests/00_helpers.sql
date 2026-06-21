-- 00_helpers.sql
-- Shared fixtures + helpers for the M1 pgTAP suite.
--
-- This file is NOT a standalone test (it asserts nothing). It is `\i`-included
-- at the top of each test file to set up a deterministic second org + an active
-- shift so the tracking gate lets test breadcrumbs through.
--
-- It builds on seed.sql''s fixed UUIDs:
--   org A   00000000-0000-0000-0000-0000000000a1   (Acme, shift_gated, 30d)
--   site A  00000000-0000-0000-0000-0000000000b1
--   admin A 00000000-0000-0000-0000-0000000000c1
--   guard A 00000000-0000-0000-0000-0000000000c2
--
-- and adds a SECOND tenant for cross-org isolation tests:
--   org B   00000000-0000-0000-0000-0000000000a2   (Beta, shift_gated, 7d)
--   site B  00000000-0000-0000-0000-0000000000b2
--   guard B 00000000-0000-0000-0000-0000000000c3
--
-- Per-install idempotency epochs (install_id) used by the RPC dedup key
-- (guard_id, install_id, client_seq). Each test breadcrumb carries one:
--   install A 00000000-0000-0000-0000-0000000000d1   (guard A's install)
--   install B 00000000-0000-0000-0000-0000000000d3   (guard B's install)

-- ---- second tenant ---------------------------------------------------------
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-0000000000a2', 'Beta Patrol AS')
on conflict (id) do nothing;

-- Beta runs a 7-day retention so purge_expired_breadcrumbs has a short-tier org.
insert into public.org_settings (org_id, tracking_mode, retention_days, lawful_basis)
values ('00000000-0000-0000-0000-0000000000a2', 'shift_gated', 7, 'legitimate_interest')
on conflict (org_id) do nothing;

insert into public.sites (id, org_id, name)
values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'Beta Zone')
on conflict (id) do nothing;

insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000000c3',
  'authenticated', 'authenticated', 'guard@beta.test',
  extensions.crypt('password123', extensions.gen_salt('bf')), now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', ''
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name, color)
values ('00000000-0000-0000-0000-0000000000c3', 'Beta Guard', '#dc2626')
on conflict (id) do nothing;

insert into public.memberships (user_id, org_id, role, site_ids, active)
values (
  '00000000-0000-0000-0000-0000000000c3',
  '00000000-0000-0000-0000-0000000000a2',
  'guard',
  array['00000000-0000-0000-0000-0000000000b2']::uuid[],
  true
)
on conflict (user_id) do nothing;

-- ---- open shifts so the gate admits test breadcrumbs -----------------------
-- A wide-open shift for guard A starting 2h ago (covers the 50-min-old buffered
-- fix used in the timestamp-integrity test). clock_out NULL → window upper bound
-- is clock_in + max_shift_interval (16h), comfortably covering "now".
insert into public.shifts (org_id, guard_id, site_id, clock_in)
values (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000c2',
  '00000000-0000-0000-0000-0000000000b1',
  now() - interval '2 hours'
)
on conflict do nothing;

insert into public.shifts (org_id, guard_id, site_id, clock_in)
values (
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000c3',
  '00000000-0000-0000-0000-0000000000b2',
  now() - interval '2 hours'
)
on conflict do nothing;
