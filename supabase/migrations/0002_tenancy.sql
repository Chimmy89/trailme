-- 0002_tenancy.sql
-- TrailMe M0 — tenancy + identity spine.
--
-- Tables: organizations, org_settings, sites, profiles, memberships,
-- guard_disclosures. RLS is enabled/forced and policies are written in 0003;
-- this migration is pure DDL + the data-integrity triggers that are intrinsic
-- to the model (DPIA gate on always_on).
--
-- All tables live in `public`. The breadcrumb firehose, guard_positions,
-- inspection_checkpoints, shifts, audit_log and erasure_registry are M1 — they
-- are intentionally NOT created here (see the stub block at the foot of file).

-- ===========================================================================
-- Enums
-- ===========================================================================

-- Membership role. The access-token hook (0004) stamps exactly this value into
-- app_metadata.role and NEVER elevates beyond the membership row.
create type public.membership_role as enum ('org_admin', 'supervisor', 'guard');

-- Org-wide tracking posture. 'always_on' is DPIA-gated (trigger below).
create type public.tracking_mode as enum ('shift_gated', 'always_on');

-- GDPR Art. 6 lawful basis. Default legitimate_interest: employee consent is
-- generally not freely given (EDPB) — see docs/GDPR.md LIA.
create type public.lawful_basis as enum ('legitimate_interest', 'consent');

-- ===========================================================================
-- organizations — the tenant root.
-- ===========================================================================
create table public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) > 0),
  -- Stripe billing seam, deferred. Nullable now so the seat-limit check / customer
  -- link drop in later with no migration touching hot tables.
  stripe_customer_id  text,
  created_at          timestamptz not null default now()
);

comment on table public.organizations is 'Tenant root. One organization == one customer company.';

-- ===========================================================================
-- org_settings — per-org privacy / plan configuration (1:1 with organizations).
-- ===========================================================================
create table public.org_settings (
  org_id              uuid primary key references public.organizations (id) on delete cascade,
  tracking_mode       public.tracking_mode not null default 'shift_gated',
  -- Retention window for the breadcrumb firehose. Only 7/30/90 are supported so
  -- partitions / soft-purge cron (M1) have a closed set of tiers to reason about.
  retention_days      integer not null default 30 check (retention_days in (7, 30, 90)),
  lawful_basis        public.lawful_basis not null default 'legitimate_interest',
  -- Must be non-null BEFORE always_on can be enabled (enforced by trigger below).
  -- Art. 35: always-on tracking of an identified person is DPIA-mandatory in NO.
  dpia_completed_at   timestamptz,
  plan                text not null default 'free',
  seat_limit          integer not null default 5 check (seat_limit > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.org_settings is 'Per-org privacy + plan config. always_on requires dpia_completed_at (trigger).';
comment on column public.org_settings.dpia_completed_at is 'Set when the DPIA is filed. Non-null is a precondition for tracking_mode = always_on.';

-- DPIA gate: forbid always_on unless a DPIA has been completed. Enforced on both
-- INSERT and UPDATE so the invariant can never be bypassed via either path.
create or replace function public.enforce_dpia_before_always_on()
returns trigger
language plpgsql
as $$
begin
  if new.tracking_mode = 'always_on' and new.dpia_completed_at is null then
    raise exception 'always_on tracking requires a completed DPIA (set dpia_completed_at first)'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger trg_org_settings_dpia_gate
  before insert or update on public.org_settings
  for each row execute function public.enforce_dpia_before_always_on();

-- ===========================================================================
-- sites — physical locations within an org. Channels and trail reads scope to a
-- site. geofence is nullable (auto clock-in/out is an M1+ feature).
-- ===========================================================================
create table public.sites (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  -- Polygon in WGS84. Nullable: a site without a geofence simply has no auto
  -- clock-in/out and is gated by explicit clock-in only.
  geofence    extensions.geography(Polygon, 4326),
  created_at  timestamptz not null default now()
);

create index sites_org_id_idx on public.sites (org_id);
comment on table public.sites is 'Physical locations within an org. Realtime channels and trail reads scope per-site.';

-- ===========================================================================
-- profiles — 1:1 with auth.users. Holds non-sensitive display data only.
-- id == auth.users.id so RLS can compare against auth.uid() directly.
-- ===========================================================================
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  -- Stable per-guard map hue (the shared map-style module derives a default from
  -- guard_id, but an explicit override lives here).
  color         text,
  created_at    timestamptz not null default now()
);

comment on table public.profiles is 'Per-user display data. id mirrors auth.users.id for direct RLS comparison.';

-- ===========================================================================
-- memberships — the authority table. A user belongs to exactly one org for MVP
-- (UNIQUE(user_id)). role + site_ids here are the LIVE source of truth that the
-- access-token hook reads and that SECURITY DEFINER helpers re-verify against.
-- ===========================================================================
create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  org_id      uuid not null references public.organizations (id) on delete cascade,
  role        public.membership_role not null,
  -- Fast-path hint of which sites the user is assigned to. Sensitive reads
  -- (trail_window, realtime channel join) re-check LIVE membership and do not
  -- trust a stale JWT copy of this array.
  site_ids    uuid[] not null default '{}',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  -- MVP: one org per user. Relaxing this (multi-org) changes how the hook picks
  -- the active org — see ARCHITECTURE.md open decisions.
  unique (user_id)
);

create index memberships_org_id_idx on public.memberships (org_id);
comment on table public.memberships is 'LIVE authority for org/role/site assignment. One org per user (MVP). Source for the access-token hook and SECURITY DEFINER re-checks.';
comment on column public.memberships.site_ids is 'Fast-path hint only; sensitive reads re-verify against this table live, never against the JWT copy.';

-- ===========================================================================
-- guard_disclosures — proof of what each guard was told before tracking started.
-- Insert is REQUIRED before tracking begins (transparency / employer-consent-
-- not-freely-given). Append-only acknowledgement record.
-- ===========================================================================
create table public.guard_disclosures (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users (id) on delete cascade,
  org_id                  uuid not null references public.organizations (id) on delete cascade,
  -- Version of the disclosure notice the guard accepted.
  notice_version          text not null,
  -- The tracking posture in effect at the moment of acceptance.
  tracking_mode_at_accept public.tracking_mode not null,
  accepted_at             timestamptz not null default now()
);

create index guard_disclosures_user_org_idx on public.guard_disclosures (user_id, org_id);
comment on table public.guard_disclosures is 'Append-only proof of disclosure acceptance per guard. Required before tracking starts.';

-- keep org_settings.updated_at honest
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_org_settings_touch
  before update on public.org_settings
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- M1+ tables (NOT created in M0 — listed here as the canonical forward map so
-- the next migration knows exactly what lands and where). DO NOT uncomment:
-- these get full, partitioned, indexed DDL in their own ordered migrations.
--
--   0005_breadcrumbs.sql:
--     location_breadcrumbs   PARTITION BY RANGE(partition_ts), composite PK
--                            (id uuidv7, partition_ts), UNIQUE(guard_id, client_seq),
--                            four hot indexes; immutable (no client UPDATE/DELETE).
--     guard_positions        thin 1-row-per-guard last-known; server-written;
--                            authoritative live marker + broadcast-relay source.
--     inspection_checkpoints uuidv7 PK; server-authoritative discrete event.
--     shifts                 window-based gate source [clock_in, clock_out].
--   0006_governance.sql:
--     audit_log              APPEND-ONLY; location-read + config-change accountability.
--     erasure_registry       static list of every guard_id-bearing table for DSAR/erase.
-- ===========================================================================
