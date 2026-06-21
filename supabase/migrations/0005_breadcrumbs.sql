-- 0005_breadcrumbs.sql
-- TrailMe M1 — the breadcrumb firehose + live positions + checkpoints + shifts.
--
-- Applies after 0001-0004 on a fresh PG15 + PostGIS. Pure DDL + indexes + RLS.
-- The SECURITY DEFINER ingest RPC, the tracking-gate trigger and the read RPCs
-- land in 0007; cron (partition create-ahead + retention) lands in 0008. This
-- file establishes the durable, partitioned, immutable storage and locks every
-- new tenant table behind FORCE RLS.
--
-- ===========================  DESIGN INVARIANTS  ===========================
--  * captured_at is the TRUE device event time. It is NEVER rewritten — it
--    drives ordering and age-fade (Art. 5(1)(d) accuracy). A legitimately old
--    buffered fix (a whole offline shift) keeps its real time.
--  * partition_ts is used ONLY for partition routing. It is derived from
--    captured_at by the ingest RPC and clamped ONLY if insane (far future /
--    absurd past). It is part of the composite PK because Postgres requires the
--    partition key to be in every unique constraint on a partitioned table.
--  * Idempotency key = (guard_id, install_id, client_seq). It deliberately
--    EXCLUDES any rewritable timestamp. install_id (a per-install UUID the client
--    persists) scopes client_seq to one install epoch: client_seq resets on app
--    reinstall, so WITHOUT install_id a fresh install''s 1,2,3… would collide with
--    the prior install''s already-ingested seqs for the same guard and be wrongly
--    dropped as duplicates — silent data loss. With install_id, a reinstall gets a
--    new epoch and its genuinely-new fixes are no longer mistaken for replays.
--    Because partition_ts is DETERMINISTIC from a given (captured_at, clamp-rule),
--    a clamped replay routes to the same partition and the same
--    (guard_id, install_id, client_seq) row, so ON CONFLICT still fires. The
--    ingest RPC ALSO does an explicit cross-partition pre-check on
--    (guard_id, install_id, client_seq) as the authoritative dedup (see 0007),
--    guarded by a per-key transaction-scoped advisory lock so the pre-check is
--    atomic even under concurrency — dedup is correct even in the pathological
--    case where two fixes with the same key could clamp to different days.
--  * IMMUTABLE to clients: there is NO update/delete RLS policy on
--    location_breadcrumbs. Rows are written only by the SECURITY DEFINER RPC.
--    Retention deletes run as a privileged cron job (0008), not as the client.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- uuidv7 helper shim. 0001 best-effort-installs pg_uuidv7 (exposes
-- extensions.uuid_generate_v7()). If it is absent we fall back to
-- gen_random_uuid(). This wrapper lets the table DEFAULT be written once and
-- resolve to whichever is available on the image. Time-ordered PKs keep the
-- hot btree(... captured_at) inserts append-mostly.
-- ---------------------------------------------------------------------------
create or replace function public.trailme_uuid()
returns uuid
language plpgsql
volatile
as $$
declare
  v uuid;
begin
  begin
    -- pg_uuidv7 installs into the `extensions` schema (see 0001).
    execute 'select extensions.uuid_generate_v7()' into v;
  exception
    when undefined_function or undefined_table or invalid_schema_name then
      v := gen_random_uuid();
  end;
  return v;
end;
$$;

comment on function public.trailme_uuid() is
  'Time-ordered UUID for high-insert PKs: pg_uuidv7 if present, else gen_random_uuid().';

-- ===========================================================================
-- location_breadcrumbs — the partitioned firehose. RANGE-partitioned on
-- partition_ts with daily child tables. ONE daily partition holds EVERY org''s
-- rows for that UTC day (retention reasoning in 0008 depends on this).
-- ===========================================================================
create table public.location_breadcrumbs (
  id                uuid        not null default public.trailme_uuid(),
  org_id            uuid        not null references public.organizations (id) on delete cascade,
  guard_id          uuid        not null references auth.users (id) on delete cascade,
  site_id           uuid        not null references public.sites (id) on delete cascade,
  geom              extensions.geography(Point, 4326) not null,
  -- TRUE device event time. Immutable. Drives ordering + age-fade.
  captured_at       timestamptz not null,
  -- Partition routing key only. Derived from captured_at; clamped only if insane.
  partition_ts      timestamptz not null,
  ingested_at       timestamptz not null default now(),
  -- Per-install UUID (client-persisted). Scopes client_seq to one install epoch.
  install_id        uuid        not null,
  -- Monotonic per-install counter. (guard_id, install_id, client_seq) is the
  -- idempotency key — install_id makes it stable across app reinstalls.
  client_seq        bigint      not null,
  accuracy_m        real,
  -- 2-min stationary heartbeat; excluded from the heatmap so a parked guard
  -- makes no false hotspot.
  is_keepalive      boolean     not null default false,
  -- captured_at was clamped, accuracy was poor, or it was a stuck last-known.
  -- Excluded from heatmap reads; retained for accountability (never silently dropped).
  is_low_confidence boolean     not null default false,
  -- Composite PK: partition key MUST be part of any PK/unique on a partitioned table.
  primary key (id, partition_ts)
) partition by range (partition_ts);

comment on table public.location_breadcrumbs is
  'Partitioned (daily, by partition_ts) immutable breadcrumb firehose. captured_at is the true device time; partition_ts is routing-only. Idempotency on (guard_id, client_seq). Client-immutable: written only by the SECURITY DEFINER RPC.';
comment on column public.location_breadcrumbs.captured_at is
  'TRUE device event time — never rewritten. Drives ordering + age-fade.';
comment on column public.location_breadcrumbs.partition_ts is
  'Partition routing only. Derived from captured_at; server-clamped if insane.';
comment on column public.location_breadcrumbs.is_low_confidence is
  'Set when clamped / poor-accuracy / stuck. Excluded from heatmap reads, retained for accountability.';

-- Idempotency backstop. A UNIQUE on a partitioned table must include the
-- partition key, so this is (guard_id, install_id, client_seq, partition_ts). The
-- AUTHORITATIVE dedup is the RPC's explicit (guard_id, install_id, client_seq)
-- pre-check (cross-partition); this index guarantees no duplicate within the
-- routed partition and is what the RPC's ON CONFLICT targets. The leading
-- (guard_id, install_id, client_seq) prefix also serves that pre-check lookup.
create unique index location_breadcrumbs_dedup_uidx
  on public.location_breadcrumbs (guard_id, install_id, client_seq, partition_ts);

-- ----- THE FOUR HOT INDEXES (exactly these) -------------------------------
-- 1. Org-scoped recent trail / window reads, covering guard_id.
create index location_breadcrumbs_org_captured_idx
  on public.location_breadcrumbs (org_id, captured_at desc) include (guard_id);
-- 2. Cheap, tiny time-range pruning across the firehose (append-mostly → BRIN).
create index location_breadcrumbs_captured_brin
  on public.location_breadcrumbs using brin (captured_at);
-- 3. Spatial — heatmap / geofence / proximity.
create index location_breadcrumbs_geom_gist
  on public.location_breadcrumbs using gist (geom);
-- 4. Per-guard trail (one guard's path over time).
create index location_breadcrumbs_guard_captured_idx
  on public.location_breadcrumbs (guard_id, captured_at desc);

-- ----- Initial partitions -------------------------------------------------
-- A few daily partitions around "now" plus a DEFAULT catch-all so an insert can
-- never fail for lack of a partition before the cron create-ahead job (0008)
-- runs. The DEFAULT also catches a far-future/absurd-past row that slipped the
-- clamp; cron-managed daily partitions normally hold everything.
--
-- NOTE: these CREATE TABLE ... PARTITION OF statements use literal bounds so the
-- file is deterministic and re-runnable. The cron function ensure_breadcrumb_partitions()
-- (0008) generates the same shape going forward and is idempotent.
do $$
declare
  d date;
  -- Match the cron horizon in 0008 (create-behind 14d to cover the realistic
  -- offline-flush window, create-ahead 10d) so the initial state is consistent
  -- with what ensure_breadcrumb_partitions() maintains nightly.
  start_day date := (current_date - 14);
  end_day   date := (current_date + 10);
  part_name text;
begin
  d := start_day;
  while d < end_day loop
    part_name := format('location_breadcrumbs_%s', to_char(d, 'YYYYMMDD'));
    if to_regclass(format('public.%I', part_name)) is null then
      execute format(
        'create table public.%I partition of public.location_breadcrumbs
           for values from (%L) to (%L)',
        part_name, d::timestamptz, (d + 1)::timestamptz
      );
    end if;
    d := d + 1;
  end loop;
end
$$;

-- DEFAULT partition — anything outside the explicit daily ranges lands here.
create table if not exists public.location_breadcrumbs_default
  partition of public.location_breadcrumbs default;

-- ===========================================================================
-- guard_positions — 1 row per guard last-known. Server-written only (the ingest
-- RPC upserts the newest fix). The authoritative live marker + relay source.
-- ===========================================================================
create table public.guard_positions (
  org_id      uuid        not null references public.organizations (id) on delete cascade,
  guard_id    uuid        primary key references auth.users (id) on delete cascade,
  site_id     uuid        not null references public.sites (id) on delete cascade,
  geom        extensions.geography(Point, 4326) not null,
  heading     real,
  captured_at timestamptz not null,
  accuracy_m  real,
  online      boolean     not null default true,
  updated_at  timestamptz not null default now()
);

create index guard_positions_org_site_idx on public.guard_positions (org_id, site_id);
comment on table public.guard_positions is
  'One row per guard: server-written last-known position. Authoritative live marker + relay source. Upserted to the newest fix by the ingest RPC.';

-- ===========================================================================
-- inspection_checkpoints — discrete server-authoritative "I inspected here" tags.
-- ===========================================================================
create table public.inspection_checkpoints (
  id        uuid        not null default public.trailme_uuid(),
  org_id    uuid        not null references public.organizations (id) on delete cascade,
  guard_id  uuid        not null references auth.users (id) on delete cascade,
  site_id   uuid        not null references public.sites (id) on delete cascade,
  geom      extensions.geography(Point, 4326) not null,
  label     text,
  tagged_at timestamptz not null default now(),
  primary key (id)
);

create index inspection_checkpoints_org_site_idx on public.inspection_checkpoints (org_id, site_id, tagged_at desc);
create index inspection_checkpoints_geom_gist     on public.inspection_checkpoints using gist (geom);
comment on table public.inspection_checkpoints is
  'Server-authoritative checkpoint tags. Written via the tag_checkpoint RPC.';

-- ===========================================================================
-- shifts — the WINDOW source for the shift-gated tracking trigger.
-- A row is [clock_in, clock_out]; an open shift has clock_out IS NULL. The gate
-- (0007) allows a breadcrumb iff captured_at ∈ [clock_in, COALESCE(clock_out,
-- clock_in + max_shift_interval)] OR the org is always_on.
-- ===========================================================================
create table public.shifts (
  id          uuid        not null default public.trailme_uuid(),
  org_id      uuid        not null references public.organizations (id) on delete cascade,
  guard_id    uuid        not null references auth.users (id) on delete cascade,
  site_id     uuid        not null references public.sites (id) on delete cascade,
  clock_in    timestamptz not null,
  clock_out   timestamptz,
  -- Set true by auto_close_forgotten_shifts() (0008) when a shift is left open
  -- past the max interval; distinguishes a forgotten clock-out from a real one.
  auto_closed boolean     not null default false,
  created_at  timestamptz not null default now(),
  primary key (id),
  constraint shifts_interval_ck check (clock_out is null or clock_out >= clock_in)
);

-- At most ONE open shift per guard (offline-reconcilable clock_in must not
-- duplicate an open shift). Partial unique index over the open rows.
create unique index shifts_one_open_per_guard_uidx
  on public.shifts (guard_id) where (clock_out is null);

create index shifts_guard_window_idx on public.shifts (guard_id, clock_in desc);
create index shifts_org_site_idx     on public.shifts (org_id, site_id);
comment on table public.shifts is
  'Shift windows [clock_in, clock_out]. At most one open shift per guard. Source for the tracking gate.';

-- ===========================================================================
-- dead_letter_breadcrumbs — HARD-rejected ingest rows. Nothing is silently
-- dropped: a row the RPC cannot accept (unparseable, forged org/site, insane
-- time it refuses, gate rejection it is configured to hard-fail) is recorded
-- here with its reason and raw payload for reconciliation / forensics.
-- ===========================================================================
create table public.dead_letter_breadcrumbs (
  id          uuid        not null default public.trailme_uuid(),
  -- org_id may be NULL if even the org could not be trusted/derived; it is the
  -- claimed org from the token where available. NOT a tenant-isolation anchor on
  -- its own — RLS below still scopes reads to the caller''s org when present.
  org_id      uuid,
  guard_id    uuid,
  client_seq  bigint,
  reason      text        not null,
  raw         jsonb       not null,
  created_at  timestamptz not null default now(),
  primary key (id)
);

create index dead_letter_breadcrumbs_org_idx     on public.dead_letter_breadcrumbs (org_id, created_at desc);
create index dead_letter_breadcrumbs_guard_idx   on public.dead_letter_breadcrumbs (guard_id, created_at desc);
comment on table public.dead_letter_breadcrumbs is
  'Hard-rejected ingest rows with reason + raw payload. Never silently drop a breadcrumb.';

-- ===========================================================================
-- FORCE RLS + policies on every new tenant table.
--
-- Reads follow the data-minimization rule:
--   * org_admin / supervisor: every row in their org (operational oversight).
--   * guard: own rows + rows for the same site(s) they are LIVE-assigned to.
-- Cross-org SELECT returns ZERO rows (org_id = authz.org_id() gate).
--
-- There are NO client write policies on the firehose tables: every write goes
-- through a SECURITY DEFINER RPC (0007) which, under FORCE RLS, is itself
-- subject to policies — so each insert path gets an explicit insert policy keyed
-- to the caller / re-verified ownership rather than a blanket allow.
-- ===========================================================================
alter table public.location_breadcrumbs    enable row level security;
alter table public.location_breadcrumbs    force  row level security;
alter table public.guard_positions         enable row level security;
alter table public.guard_positions         force  row level security;
alter table public.inspection_checkpoints  enable row level security;
alter table public.inspection_checkpoints  force  row level security;
alter table public.shifts                  enable row level security;
alter table public.shifts                  force  row level security;
alter table public.dead_letter_breadcrumbs enable row level security;
alter table public.dead_letter_breadcrumbs force  row level security;

-- ----- location_breadcrumbs ----------------------------------------------
-- SELECT: org-isolated; a guard sees own rows OR rows for a site they can access
-- (has_site_access does the org-wide-role-vs-assigned-site logic LIVE).
create policy location_breadcrumbs_select
  on public.location_breadcrumbs for select to authenticated
  using (
    org_id = authz.org_id()
    and (
      guard_id = (select auth.uid())
      or authz.has_site_access(site_id)
    )
  );

-- INSERT: only by the ingest RPC (runs as definer-owner, still subject to FORCE
-- RLS). The owner is exempt from the SELECT minimization but NOT from a missing
-- INSERT policy, so we add a precise one: the row's org AND site must be covered
-- by the row's guard's LIVE active membership (org-wide role over any org site,
-- or the guard assigned to that site). This MIRRORS the RPC's SQL re-verify so
-- the RLS layer is a true backstop for the same invariant — not a weaker org-only
-- check. The RPC re-verifies too (defense in depth).
create policy location_breadcrumbs_insert_via_rpc
  on public.location_breadcrumbs for insert to authenticated, service_role
  with check (
    exists (
      select 1 from public.memberships m
      where m.user_id = location_breadcrumbs.guard_id
        and m.org_id  = location_breadcrumbs.org_id
        and m.active
        and (
          -- org-wide roles cover all org sites; the site must belong to the org
          (m.role in ('org_admin','supervisor')
             and exists (select 1 from public.sites s
                         where s.id = location_breadcrumbs.site_id
                           and s.org_id = location_breadcrumbs.org_id))
          -- guards must be assigned to the site
          or location_breadcrumbs.site_id = any (m.site_ids)
        )
    )
  );
-- No UPDATE / DELETE policy: immutable to clients. Retention runs as cron-owner.

-- ----- guard_positions ----------------------------------------------------
create policy guard_positions_select
  on public.guard_positions for select to authenticated
  using (
    org_id = authz.org_id()
    and (
      guard_id = (select auth.uid())
      or authz.has_site_access(site_id)
    )
  );

create policy guard_positions_write_via_rpc
  on public.guard_positions for insert to authenticated, service_role
  with check (
    exists (
      select 1 from public.memberships m
      where m.user_id = guard_positions.guard_id
        and m.org_id  = guard_positions.org_id
        and m.active
        and (
          (m.role in ('org_admin','supervisor')
             and exists (select 1 from public.sites s
                         where s.id = guard_positions.site_id
                           and s.org_id = guard_positions.org_id))
          or guard_positions.site_id = any (m.site_ids)
        )
    )
  );
create policy guard_positions_update_via_rpc
  on public.guard_positions for update to authenticated, service_role
  using (
    exists (
      select 1 from public.memberships m
      where m.user_id = guard_positions.guard_id
        and m.org_id  = guard_positions.org_id
        and m.active
        and (
          (m.role in ('org_admin','supervisor')
             and exists (select 1 from public.sites s
                         where s.id = guard_positions.site_id
                           and s.org_id = guard_positions.org_id))
          or guard_positions.site_id = any (m.site_ids)
        )
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.user_id = guard_positions.guard_id
        and m.org_id  = guard_positions.org_id
        and m.active
        and (
          (m.role in ('org_admin','supervisor')
             and exists (select 1 from public.sites s
                         where s.id = guard_positions.site_id
                           and s.org_id = guard_positions.org_id))
          or guard_positions.site_id = any (m.site_ids)
        )
    )
  );

-- ----- inspection_checkpoints --------------------------------------------
create policy inspection_checkpoints_select
  on public.inspection_checkpoints for select to authenticated
  using (
    org_id = authz.org_id()
    and (
      guard_id = (select auth.uid())
      or authz.has_site_access(site_id)
    )
  );

create policy inspection_checkpoints_insert_via_rpc
  on public.inspection_checkpoints for insert to authenticated, service_role
  with check (
    org_id = authz.org_id()
    and guard_id = (select auth.uid())
    and authz.has_site_access(site_id)
  );

-- ----- shifts -------------------------------------------------------------
create policy shifts_select
  on public.shifts for select to authenticated
  using (
    org_id = authz.org_id()
    and (
      guard_id = (select auth.uid())
      or authz.has_site_access(site_id)
    )
  );

create policy shifts_insert_via_rpc
  on public.shifts for insert to authenticated, service_role
  with check (
    org_id = authz.org_id()
    and guard_id = (select auth.uid())
    and authz.has_site_access(site_id)
  );
create policy shifts_update_via_rpc
  on public.shifts for update to authenticated, service_role
  using (org_id = authz.org_id() and guard_id = (select auth.uid()))
  with check (org_id = authz.org_id() and guard_id = (select auth.uid()));

-- ----- dead_letter_breadcrumbs -------------------------------------------
-- Only org_admin / supervisor read the DLQ, and only within their org. Inserts
-- come from the SECURITY DEFINER ingest path.
create policy dead_letter_select_oversight
  on public.dead_letter_breadcrumbs for select to authenticated
  using (
    org_id = authz.org_id()
    and (authz.has_role('org_admin') or authz.has_role('supervisor'))
  );

create policy dead_letter_insert_via_rpc
  on public.dead_letter_breadcrumbs for insert to authenticated, service_role
  with check (true);

-- ===========================================================================
-- Grants. Application roles reach these tables ONLY through the RPCs + the
-- SELECT policies above. We grant the table privileges RLS then filters; we do
-- NOT grant UPDATE/DELETE on the firehose to anyone but the owner (cron).
-- ===========================================================================
grant select on public.location_breadcrumbs    to authenticated;
grant select on public.guard_positions          to authenticated;
grant select, insert on public.inspection_checkpoints to authenticated;
grant select on public.shifts                   to authenticated;
grant select on public.dead_letter_breadcrumbs  to authenticated;

-- The ingest path uses the service client; service_role already bypasses grants,
-- but we keep insert grants explicit for the definer-owner execution context.
grant insert, update on public.guard_positions      to service_role;
grant insert         on public.location_breadcrumbs to service_role;
grant insert         on public.dead_letter_breadcrumbs to service_role;
