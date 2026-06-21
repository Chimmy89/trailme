-- 0007_rpcs.sql
-- TrailMe M1 — the RPC surface: ingest, the tracking gate, shift lifecycle,
-- checkpoint tagging, and the audited trail-window read.
--
-- Applies after 0006. Everything here is server-authoritative. The ingest path
-- and the trail read are SECURITY DEFINER and re-verify authorization in SQL
-- (defense-in-depth) rather than trusting a JWT claim.
--
-- The single tunable used by the gate / auto-close is the org''s max shift
-- interval. It is not in org_settings yet (M0), so we centralize it here as a
-- constant function; later it can read a column without touching call sites.

-- ===========================================================================
-- trailme_max_shift_interval() — the longest a single shift can run before an
-- open shift is presumed forgotten. Used by the gate (window upper bound when
-- clock_out is NULL) and by auto_close_forgotten_shifts (0008).
-- ===========================================================================
create or replace function public.trailme_max_shift_interval()
returns interval
language sql
immutable
as $$ select interval '16 hours' $$;

comment on function public.trailme_max_shift_interval() is
  'Max single-shift duration. Gate upper bound for an open shift + auto-close threshold.';

-- ===========================================================================
-- enforce_tracking_gate() — BEFORE INSERT trigger on location_breadcrumbs.
--
-- WINDOW-BASED. A row is allowed iff EITHER:
--   * the org is always_on (continuous tracking, DPIA-gated upstream), OR
--   * captured_at ∈ [shift.clock_in, COALESCE(shift.clock_out,
--                    shift.clock_in + max_shift_interval)] for SOME shift of
--     that guard.
-- Otherwise the row is OFF-SHIFT and REJECTED — never silently dropped: the
-- trigger RAISES a dedicated SQLSTATE the RPC catches, records the rejection in
-- its per-row report, and writes the raw fix to dead_letter_breadcrumbs.
--
-- SECURITY DEFINER so it can read org_settings/shifts regardless of the inserting
-- context's RLS. Empty search_path against injection.
-- ===========================================================================
create or replace function public.enforce_tracking_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode public.tracking_mode;
  v_ok   boolean;
begin
  select s.tracking_mode into v_mode
  from public.org_settings s
  where s.org_id = new.org_id;

  -- Unknown org settings → fail closed (no tracking authorized).
  if v_mode is null then
    raise exception 'tracking gate: no org_settings for org %', new.org_id
      using errcode = 'P0001', detail = 'off_shift_gate';
  end if;

  if v_mode = 'always_on' then
    return new; -- continuous tracking authorized at the org level
  end if;

  -- shift_gated: require an enclosing shift window for this guard.
  select exists (
    select 1
    from public.shifts sh
    where sh.guard_id = new.guard_id
      and new.captured_at >= sh.clock_in
      and new.captured_at <= coalesce(
            sh.clock_out,
            sh.clock_in + public.trailme_max_shift_interval()
          )
  ) into v_ok;

  if not v_ok then
    -- DETAIL carries the @trailme/shared reject reason code so the RPC can map
    -- the raised error to a structured per-row reason without string-parsing.
    raise exception 'tracking gate: off-shift breadcrumb for guard %', new.guard_id
      using errcode = 'P0001', detail = 'off_shift_gate';
  end if;

  return new;
end;
$$;

create trigger trg_breadcrumbs_tracking_gate
  before insert on public.location_breadcrumbs
  for each row execute function public.enforce_tracking_gate();

comment on function public.enforce_tracking_gate() is
  'BEFORE INSERT gate on location_breadcrumbs. Allows a row iff always_on OR captured_at is inside a shift window for the guard. Else raises P0001 with DETAIL=off_shift_gate (RPC maps to a rejection; never silent).';

-- ===========================================================================
-- INSANE-TIMESTAMP bounds. The ingest function (edge) derives partition_ts and
-- clamps if insane; these helpers let the RPC re-assert the policy server-side
-- so a forged direct RPC call cannot smuggle an absurd partition_ts past the
-- edge clamp. "Insane" = more than 1 day in the future, or older than the
-- global max retention (so it could never live in a retained partition).
--
-- INVARIANT (keep these two in lockstep): the CLAMP window in trailme_partition_ts
-- must be a (non-strict) SUPERSET of the ACCEPT window in
-- trailme_captured_at_is_insane — i.e. the same +1d / -90d magic bounds. Because
-- the RPC rejects insane rows at step (2) BEFORE routing, the clamp branches are
-- effectively unreachable for the accepted path today; they exist as a
-- defense-in-depth backstop. If a future change relaxes the accept bound, it MUST
-- relax the clamp bound identically, or an accepted old fix would be clamped —
-- silently moving partition_ts off its true day while captured_at stays put,
-- re-introducing exactly the integrity risk the design forbids. The edge
-- function's FUTURE_SLACK_MS / PAST_SLACK_MS constants mirror these same bounds.
-- ===========================================================================
create or replace function public.trailme_partition_ts(p_captured_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select case
    when p_captured_at > now() + interval '1 day'            then date_trunc('day', now())
    when p_captured_at < now() - interval '90 days'          then date_trunc('day', now() - interval '90 days')
    else date_trunc('day', p_captured_at)
  end;
$$;

create or replace function public.trailme_captured_at_is_insane(p_captured_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_captured_at > now() + interval '1 day'
      or p_captured_at < now() - interval '90 days';
$$;

comment on function public.trailme_partition_ts(timestamptz) is
  'Daily partition bucket for a captured_at, server-clamped if insane (>1d future / >90d past).';

-- ===========================================================================
-- batch_insert_breadcrumbs(p_rows jsonb) — the durable, idempotent ingest RPC.
--
-- Input: a JSON array of rows in the @trailme/shared wire shape, AUGMENTED by
-- the edge function with the trusted token claims and its accuracy/keepalive
-- decisions:
--   [{ guard_id, install_id, org_id, site_id, lat, lon, captured_at, client_seq,
--      accuracy_m, is_keepalive, is_low_confidence }, ...]
--
-- For each row it:
--   1. RE-VERIFIES org_id + site_id against the guard''s LIVE active membership
--      (defense-in-depth vs a forged/stale token claim). A guard who is not an
--      active member of that org — or whose membership does not cover that site
--      — is REJECTED with the distinct security reason 'forged_or_inactive', NOT
--      inserted, and the raw row is dead-lettered. The reason is deliberately
--      NOT 'off_shift_gate' so a forgery attempt is distinguishable from a benign
--      off-shift fix in the client report and in alerting.
--   2. Skips rows whose captured_at is insane beyond the clamp window
--      (reason 'captured_at_insane') → dead-letter.
--   3. Builds geography from lat/lon, routes via partition_ts = clamped bucket.
--   4. Inserts with ON CONFLICT (guard_id, install_id, client_seq, partition_ts)
--      DO NOTHING AND an explicit cross-partition pre-check on
--      (guard_id, install_id, client_seq) so a replay that clamped to a different
--      day still dedups (reason 'duplicate'). install_id scopes the seq to one
--      install epoch so a reinstall is not falsely deduped.
--   5. Catches the tracking-gate rejection (P0001 / off_shift_gate) per row,
--      reports it, and dead-letters the raw row.
--   6. Upserts guard_positions to the NEWEST accepted fix per guard.
--
-- Returns a per-row report: jsonb { accepted: int, rejected: [{client_seq, reason}] }
-- matching @trailme/shared BreadcrumbIngestResult.
-- ===========================================================================
create or replace function public.batch_insert_breadcrumbs(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r              jsonb;
  v_guard_id     uuid;
  v_install_id   uuid;
  v_org_id       uuid;
  v_site_id      uuid;
  v_lat          double precision;
  v_lon          double precision;
  v_captured_at  timestamptz;
  v_client_seq   bigint;
  v_accuracy     real;
  v_keepalive    boolean;
  v_low_conf     boolean;
  v_geom         extensions.geography(Point, 4326);
  v_part_ts      timestamptz;
  v_member_ok    boolean;
  v_row_count    int;
  v_accepted     int := 0;
  v_rejected     jsonb := '[]'::jsonb;

  -- newest accepted fix per guard, for the guard_positions upsert
  v_pos_guard    uuid;
  v_pos_org      uuid;
  v_pos_site     uuid;
  v_pos_geom     extensions.geography(Point, 4326);
  v_pos_ts       timestamptz;
  v_pos_acc      real;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'batch_insert_breadcrumbs: p_rows must be a JSON array';
  end if;

  for r in select * from jsonb_array_elements(p_rows)
  loop
    -- ----- parse (defensive) ------------------------------------------------
    begin
      v_guard_id    := (r ->> 'guard_id')::uuid;
      v_install_id  := (r ->> 'install_id')::uuid;
      v_org_id      := (r ->> 'org_id')::uuid;
      v_site_id     := (r ->> 'site_id')::uuid;
      v_lat         := (r ->> 'lat')::double precision;
      v_lon         := (r ->> 'lon')::double precision;
      v_captured_at := (r ->> 'captured_at')::timestamptz;
      v_client_seq  := (r ->> 'client_seq')::bigint;
      v_accuracy    := nullif(r ->> 'accuracy_m', '')::real;
      v_keepalive   := coalesce((r ->> 'is_keepalive')::boolean, false);
      v_low_conf    := coalesce((r ->> 'is_low_confidence')::boolean, false);
    exception when others then
      v_rejected := v_rejected || jsonb_build_object(
        'clientSeq', coalesce((r ->> 'client_seq')::bigint, -1),
        'reason', 'unparseable');
      insert into public.dead_letter_breadcrumbs (org_id, guard_id, client_seq, reason, raw)
      values (null, null, null, 'unparseable', r);
      continue;
    end;

    -- ----- (1) re-verify org + site against LIVE membership -----------------
    select exists (
      select 1
      from public.memberships m
      where m.user_id = v_guard_id
        and m.org_id  = v_org_id
        and m.active
        and (
          -- org-wide roles cover all org sites; a site must belong to the org
          (m.role in ('org_admin','supervisor')
             and exists (select 1 from public.sites s where s.id = v_site_id and s.org_id = v_org_id))
          -- guards must be assigned to the site
          or v_site_id = any (m.site_ids)
        )
    ) into v_member_ok;

    if not v_member_ok then
      -- SECURITY-RELEVANT rejection: the claimed org/site does not match the
      -- guard's LIVE membership (forged/stale claim, or inactive guard). Report a
      -- DISTINCT reason so the client and any alerting can tell a forgery attempt
      -- from a benign off-shift fix — never mislabel this as 'off_shift_gate'.
      v_rejected := v_rejected || jsonb_build_object('clientSeq', v_client_seq, 'reason', 'forged_or_inactive');
      -- DO NOT stamp the CLAIMED (attacker-controlled) org_id onto the DLQ row:
      -- dead_letter_breadcrumbs is read per-org by oversight, so a forged claim
      -- could otherwise inject a visible row into a VICTIM org's DLQ. Store NULL
      -- org_id (it failed verification); the claimed value survives only inside
      -- `raw` for forensics, which the oversight UI must treat as untrusted input.
      insert into public.dead_letter_breadcrumbs (org_id, guard_id, client_seq, reason, raw)
      values (null, v_guard_id, v_client_seq, 'forged_or_inactive_membership', r);
      continue;
    end if;

    -- ----- (2) insane captured_at (beyond clamp) → reject -------------------
    if public.trailme_captured_at_is_insane(v_captured_at) then
      v_rejected := v_rejected || jsonb_build_object('clientSeq', v_client_seq, 'reason', 'captured_at_insane');
      insert into public.dead_letter_breadcrumbs (org_id, guard_id, client_seq, reason, raw)
      values (v_org_id, v_guard_id, v_client_seq, 'captured_at_insane', r);
      continue;
    end if;

    -- ----- (3) geometry + partition routing ---------------------------------
    v_geom    := extensions.st_setsrid(extensions.st_makepoint(v_lon, v_lat), 4326)::extensions.geography;
    v_part_ts := public.trailme_partition_ts(v_captured_at);

    -- ----- (4a) explicit cross-partition dedup pre-check --------------------
    -- The unique index is (guard_id, install_id, client_seq, partition_ts); it can
    -- only enforce uniqueness WITHIN a partition. To make the cross-partition
    -- pre-check atomic (so two concurrent inserts of the same key that route to
    -- DIFFERENT partitions — the clamp-boundary edge — cannot both pass the EXISTS
    -- and both insert), serialize per dedup key with a transaction-scoped advisory
    -- lock. hashtextextended folds (guard_id, install_id, client_seq) into the
    -- lock key. The lock is released at COMMIT/ROLLBACK; it only serializes the
    -- rare same-key concurrent case, not the firehose at large.
    perform pg_advisory_xact_lock(
      hashtextextended(v_guard_id::text || ':' || v_install_id::text || ':' || v_client_seq::text, 0)
    );

    -- install_id scopes the seq to one install epoch so a reinstall's reset
    -- counter is NOT falsely treated as a replay.
    if exists (
      select 1 from public.location_breadcrumbs b
      where b.guard_id = v_guard_id
        and b.install_id = v_install_id
        and b.client_seq = v_client_seq
    ) then
      v_rejected := v_rejected || jsonb_build_object('clientSeq', v_client_seq, 'reason', 'duplicate');
      continue;
    end if;

    -- ----- (4b/5) insert; gate trigger may reject → catch per row -----------
    v_row_count := 0;
    begin
      insert into public.location_breadcrumbs (
        org_id, guard_id, install_id, site_id, geom, captured_at, partition_ts,
        client_seq, accuracy_m, is_keepalive, is_low_confidence
      )
      values (
        v_org_id, v_guard_id, v_install_id, v_site_id, v_geom, v_captured_at, v_part_ts,
        v_client_seq, v_accuracy, v_keepalive, v_low_conf
      )
      on conflict (guard_id, install_id, client_seq, partition_ts) do nothing;

      -- ON CONFLICT DO NOTHING → 0 rows inserted; row_count distinguishes
      -- inserted (1) vs deduped-on-conflict (0).
      get diagnostics v_row_count = row_count;
    exception
      when sqlstate 'P0001' then
        -- tracking-gate (or no-settings) rejection. DETAIL carries the reason.
        v_rejected := v_rejected || jsonb_build_object('clientSeq', v_client_seq, 'reason', 'off_shift_gate');
        insert into public.dead_letter_breadcrumbs (org_id, guard_id, client_seq, reason, raw)
        values (v_org_id, v_guard_id, v_client_seq, 'off_shift_gate', r);
        continue;
      when others then
        -- Unexpected INSERT failure (not a parse error, not a gate/dedup
        -- decision). Report 'insert_error' so the client report and the
        -- dead-letter reason agree and a real server fault is visible — the row
        -- parsed fine, so 'unparseable' would be wrong.
        v_rejected := v_rejected || jsonb_build_object('clientSeq', v_client_seq, 'reason', 'insert_error');
        insert into public.dead_letter_breadcrumbs (org_id, guard_id, client_seq, reason, raw)
        values (v_org_id, v_guard_id, v_client_seq, 'insert_error', r);
        continue;
    end;

    if v_row_count = 0 then
      -- ON CONFLICT fired → already present → duplicate, not an error.
      v_rejected := v_rejected || jsonb_build_object('clientSeq', v_client_seq, 'reason', 'duplicate');
      continue;
    end if;

    v_accepted := v_accepted + 1;

    -- track newest accepted fix per guard for the position upsert.
    -- (Single guard per device, but a batch could in theory carry several; we
    --  keep the maximum captured_at and DO NOT let a stuck/older fix overwrite.)
    if v_pos_ts is null or v_captured_at > v_pos_ts then
      v_pos_guard := v_guard_id;
      v_pos_org   := v_org_id;
      v_pos_site  := v_site_id;
      v_pos_geom  := v_geom;
      v_pos_ts    := v_captured_at;
      v_pos_acc   := v_accuracy;
    end if;
  end loop;

  -- ----- (6) upsert guard_positions to the newest accepted fix -------------
  -- Only advance when the new fix is STRICTLY newer than the stored one, so an
  -- out-of-order late flush never rewinds the live marker.
  if v_pos_guard is not null then
    insert into public.guard_positions (org_id, guard_id, site_id, geom, captured_at, accuracy_m, online, updated_at)
    values (v_pos_org, v_pos_guard, v_pos_site, v_pos_geom, v_pos_ts, v_pos_acc, true, now())
    on conflict (guard_id) do update
      set org_id      = excluded.org_id,
          site_id     = excluded.site_id,
          geom        = excluded.geom,
          captured_at = excluded.captured_at,
          accuracy_m  = excluded.accuracy_m,
          online      = true,
          updated_at  = now()
      where excluded.captured_at > public.guard_positions.captured_at;
  end if;

  return jsonb_build_object('accepted', v_accepted, 'rejected', v_rejected);
end;
$$;

comment on function public.batch_insert_breadcrumbs(jsonb) is
  'Idempotent, defense-in-depth breadcrumb ingest. Re-verifies org/site vs LIVE membership, dedups on (guard_id, install_id, client_seq) (install_id scopes the seq across reinstalls), routes by clamped partition_ts, catches the tracking gate per row, dead-letters hard rejects, upserts newest guard_positions. Returns {accepted, rejected[]}.';

revoke execute on function public.batch_insert_breadcrumbs(jsonb) from public, anon;
grant  execute on function public.batch_insert_breadcrumbs(jsonb) to service_role;

-- ===========================================================================
-- clock_in(p_site) — open a shift. Offline-reconcilable: accepts a client event
-- time, tolerates out-of-order, and DOES NOT duplicate an already-open shift
-- (the partial unique index enforces at most one open shift; we also short-
-- circuit so a re-issued clock_in returns the existing shift rather than erroring).
-- ===========================================================================
create or replace function public.clock_in(
  p_site uuid,
  p_at   timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid := authz.org_id();
  v_shift uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'clock_in: no active membership' using errcode = 'P0001';
  end if;
  if not authz.has_site_access(p_site) then
    raise exception 'clock_in: no access to site %', p_site using errcode = 'P0001';
  end if;

  -- already open? return it (idempotent clock-in; offline retry friendly).
  select id into v_shift
  from public.shifts
  where guard_id = v_uid and clock_out is null
  limit 1;

  if v_shift is not null then
    return v_shift;
  end if;

  insert into public.shifts (org_id, guard_id, site_id, clock_in)
  values (v_org, v_uid, p_site, p_at)
  returning id into v_shift;

  return v_shift;
end;
$$;

comment on function public.clock_in(uuid, timestamptz) is
  'Open a shift (idempotent: returns the existing open shift if any). Offline-reconcilable client event time.';

-- ===========================================================================
-- clock_out() — close the caller''s open shift. Tolerates "already closed"
-- (returns null) so an offline retry does not error. clock_out time is clamped
-- to be >= clock_in (an out-of-order late close cannot invert the interval).
-- ===========================================================================
create or replace function public.clock_out(
  p_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_shift uuid;
  v_in    timestamptz;
begin
  if v_uid is null then
    raise exception 'clock_out: not authenticated' using errcode = 'P0001';
  end if;

  select id, clock_in into v_shift, v_in
  from public.shifts
  where guard_id = v_uid and clock_out is null
  limit 1;

  if v_shift is null then
    return null; -- nothing open; idempotent no-op
  end if;

  update public.shifts
     set clock_out = greatest(p_at, v_in)  -- never invert the interval
   where id = v_shift;

  return v_shift;
end;
$$;

comment on function public.clock_out(timestamptz) is
  'Close the caller''s open shift (idempotent no-op if none open). clock_out clamped >= clock_in.';

-- ===========================================================================
-- tag_checkpoint(p_site, p_lat, p_lon, p_label) — server-authoritative tag.
-- ===========================================================================
create or replace function public.tag_checkpoint(
  p_site  uuid,
  p_lat   double precision,
  p_lon   double precision,
  p_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := authz.org_id();
  v_id  uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'tag_checkpoint: no active membership' using errcode = 'P0001';
  end if;
  if not authz.has_site_access(p_site) then
    raise exception 'tag_checkpoint: no access to site %', p_site using errcode = 'P0001';
  end if;

  insert into public.inspection_checkpoints (org_id, guard_id, site_id, geom, label)
  values (
    v_org, v_uid, p_site,
    extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography,
    p_label
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.tag_checkpoint(uuid, double precision, double precision, text) is
  'Insert a server-authoritative inspection checkpoint at the caller''s position.';

-- ===========================================================================
-- trail_window(p_site, p_minutes) — server-decimated recent breadcrumbs for a
-- site over the window. RE-CHECKS authz.has_site_access(p_site) LIVE and WRITES
-- a trail_window_read audit_log row (who watched whom). p_minutes ∈ allowed set.
--
-- "Decimated": at most ~1 point per guard per ~5s bucket, low-confidence and
-- keepalive points excluded — so a heatmap-style read of a parked guard yields
-- no false hotspot and the payload stays bounded.
-- ===========================================================================
create or replace function public.trail_window(
  p_site    uuid,
  p_minutes int
)
returns table (
  guard_id    uuid,
  lat         double precision,
  lon         double precision,
  captured_at timestamptz,
  accuracy_m  real
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := authz.org_id();
begin
  if v_uid is null or v_org is null then
    raise exception 'trail_window: no active membership' using errcode = 'P0001';
  end if;

  -- closed set of windows (mirrors @trailme/shared TIME_WINDOWS).
  if p_minutes not in (5, 10, 15, 30, 60, 120) then
    raise exception 'trail_window: p_minutes must be one of 5/10/15/30/60/120 (got %)', p_minutes
      using errcode = 'P0001';
  end if;

  -- LIVE site authorization (closes the stale-JWT-site_ids window).
  if not authz.has_site_access(p_site) then
    raise exception 'trail_window: no access to site %', p_site using errcode = 'P0001';
  end if;

  -- Accountability: record who read which site''s trail over what window.
  perform public.write_audit_log(
    v_org, v_uid, 'trail_window_read', null,
    jsonb_build_object('site_id', p_site, 'minutes', p_minutes)
  );

  return query
  with raw as (
    select b.guard_id,
           b.geom,
           b.captured_at,
           b.accuracy_m,
           -- 5-second decimation bucket per guard.
           date_bin(interval '5 seconds', b.captured_at, timestamptz 'epoch') as bucket
    from public.location_breadcrumbs b
    where b.org_id = v_org
      and b.site_id = p_site
      and b.captured_at >= now() - make_interval(mins => p_minutes)
      and b.is_low_confidence = false
      and b.is_keepalive = false
  ),
  decimated as (
    select distinct on (raw.guard_id, raw.bucket)
           raw.guard_id, raw.geom, raw.captured_at, raw.accuracy_m
    from raw
    order by raw.guard_id, raw.bucket, raw.captured_at desc
  )
  select d.guard_id,
         extensions.st_y(d.geom::extensions.geometry) as lat,
         extensions.st_x(d.geom::extensions.geometry) as lon,
         d.captured_at,
         d.accuracy_m
  from decimated d
  order by d.guard_id, d.captured_at;
end;
$$;

comment on function public.trail_window(uuid, int) is
  'Audited, server-decimated recent-trail read for a site. Re-checks has_site_access LIVE, writes a trail_window_read audit row, excludes low-confidence/keepalive points. p_minutes ∈ {5,10,15,30,60,120}.';

-- Grants. These RPCs are called by authenticated users via the Data API.
revoke execute on function public.clock_in(uuid, timestamptz)      from public, anon;
revoke execute on function public.clock_out(timestamptz)           from public, anon;
revoke execute on function public.tag_checkpoint(uuid, double precision, double precision, text) from public, anon;
revoke execute on function public.trail_window(uuid, int)          from public, anon;

grant execute on function public.clock_in(uuid, timestamptz)       to authenticated;
grant execute on function public.clock_out(timestamptz)            to authenticated;
grant execute on function public.tag_checkpoint(uuid, double precision, double precision, text) to authenticated;
grant execute on function public.trail_window(uuid, int)           to authenticated;
