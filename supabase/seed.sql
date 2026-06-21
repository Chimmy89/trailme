-- seed.sql
-- TrailMe M0 — minimal fixture so the login test has data.
--
-- Creates: one organization, its org_settings (shift_gated / 30-day retention),
-- one site, two auth users (org_admin + guard) with profiles, memberships, and a
-- guard_disclosure for the guard. Runs after migrations on `supabase db reset`.
--
-- Fixed UUIDs so tests can reference rows deterministically. Passwords are
-- bcrypt-hashed via pgcrypto's crypt()/gen_salt('bf'); both users sign in with
-- password 'password123'. Local/dev fixture ONLY — never seed real credentials.
--
-- Idempotent: guarded by ON CONFLICT so a re-run (or a reset that re-applies the
-- seed) does not error.

-- --------------------------------------------------------------------------
-- Deterministic fixture IDs
--   org   00000000-0000-0000-0000-0000000000a1
--   site  00000000-0000-0000-0000-0000000000b1
--   admin 00000000-0000-0000-0000-0000000000c1   (org_admin)
--   guard 00000000-0000-0000-0000-0000000000c2   (guard)
-- --------------------------------------------------------------------------

-- ===========================================================================
-- Organization + settings + site
-- ===========================================================================
insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-0000000000a1', 'Acme Security AS')
on conflict (id) do nothing;

insert into public.org_settings (org_id, tracking_mode, retention_days, lawful_basis)
values ('00000000-0000-0000-0000-0000000000a1', 'shift_gated', 30, 'legitimate_interest')
on conflict (org_id) do nothing;

insert into public.sites (id, org_id, name)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Downtown Patrol Zone')
on conflict (id) do nothing;

-- ===========================================================================
-- Auth users. GoTrue requires a row in auth.users AND a matching auth.identities
-- row (provider 'email') for password sign-in to succeed. We set
-- email_confirmed_at so the user can sign in immediately under
-- enable_confirmations = false.
-- ===========================================================================
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000c1',
    'authenticated', 'authenticated', 'admin@acme.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-0000000000c2',
    'authenticated', 'authenticated', 'guard@acme.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  )
on conflict (id) do nothing;

-- Matching identities (provider_id == user id for the email provider).
insert into auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values
  (
    gen_random_uuid(),
    '00000000-0000-0000-0000-0000000000c1',
    '00000000-0000-0000-0000-0000000000c1',
    '{"sub":"00000000-0000-0000-0000-0000000000c1","email":"admin@acme.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(),
    '00000000-0000-0000-0000-0000000000c2',
    '00000000-0000-0000-0000-0000000000c2',
    '{"sub":"00000000-0000-0000-0000-0000000000c2","email":"guard@acme.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email', now(), now(), now()
  )
on conflict (provider_id, provider) do nothing;

-- ===========================================================================
-- Profiles
-- ===========================================================================
insert into public.profiles (id, display_name, color)
values
  ('00000000-0000-0000-0000-0000000000c1', 'Acme Admin', '#2563eb'),
  ('00000000-0000-0000-0000-0000000000c2', 'Guard One',  '#16a34a')
on conflict (id) do nothing;

-- ===========================================================================
-- Memberships — the authority the access-token hook reads. Admin sees all sites
-- by role; guard is explicitly assigned to the one seeded site.
-- ===========================================================================
insert into public.memberships (user_id, org_id, role, site_ids, active)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'org_admin', '{}', true),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'guard',
     array['00000000-0000-0000-0000-0000000000b1']::uuid[], true)
on conflict (user_id) do nothing;

-- ===========================================================================
-- Guard disclosure — the pre-tracking acknowledgement for the guard.
-- ===========================================================================
insert into public.guard_disclosures (user_id, org_id, notice_version, tracking_mode_at_accept)
values
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'v1', 'shift_gated')
on conflict do nothing;
