-- 0012_live_read_rpcs.sql
-- M3 read side. The dashboard cut-over (Phase 2) needs two site-scoped reads that
-- carry per-guard display_name/color (the broadcast tick carries them too):
--   - trail_window: extend the existing 0007 RPC with display_name + color (return
--     type changes, so DROP + recreate; everything else preserved verbatim).
--   - live_positions: last-known server position per guard for a site — the mount
--     seed companion and the slow reconcile fallback for silently-dead sockets.

-- trail_window: add display_name + color (return shape changes -> drop + recreate).
drop function if exists public.trail_window(uuid, int);

create or replace function public.trail_window(
  p_site    uuid,
  p_minutes int
)
returns table (
  guard_id     uuid,
  display_name text,
  color        text,
  lat          double precision,
  lon          double precision,
  captured_at  timestamptz,
  accuracy_m   real
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

  -- Accountability: record who read which site's trail over what window.
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
  -- LEFT JOIN: a guard with breadcrumbs but no profile row still appears (client
  -- falls back to a default name/colour), rather than vanishing from the trail.
  select d.guard_id,
         p.display_name,
         p.color,
         extensions.st_y(d.geom::extensions.geometry) as lat,
         extensions.st_x(d.geom::extensions.geometry) as lon,
         d.captured_at,
         d.accuracy_m
  from decimated d
  left join public.profiles p on p.id = d.guard_id
  order by d.guard_id, d.captured_at;
end;
$$;

comment on function public.trail_window(uuid, int) is
  'M3/M4: server-decimated per-guard trail history for a site over a window (5/10/15/30/60/120 min) with display_name/color. LIVE has_site_access check + audit row. SECURITY DEFINER.';

revoke execute on function public.trail_window(uuid, int) from public, anon;
grant  execute on function public.trail_window(uuid, int) to authenticated;

-- live_positions: last-known server position per guard for a site. Used as the
-- mount-seed companion and the slow reconcile fallback when a socket dies
-- silently (M3 verify e). NO audit row — it's a frequent liveness poll, not a
-- trail read; auditing every reconcile would swamp the audit_log.
create or replace function public.live_positions(p_site uuid)
returns table (
  guard_id     uuid,
  display_name text,
  color        text,
  lat          double precision,
  lon          double precision,
  captured_at  timestamptz,
  accuracy_m   real,
  online       boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := authz.org_id();
begin
  if v_org is null then
    raise exception 'live_positions: no active membership' using errcode = 'P0001';
  end if;

  -- LIVE site authorization, same gate as trail_window / the channel join.
  if not authz.has_site_access(p_site) then
    raise exception 'live_positions: no access to site %', p_site using errcode = 'P0001';
  end if;

  return query
  select g.guard_id,
         p.display_name,
         p.color,
         extensions.st_y(g.geom::extensions.geometry) as lat,
         extensions.st_x(g.geom::extensions.geometry) as lon,
         g.captured_at,
         g.accuracy_m,
         g.online
  from public.guard_positions g
  left join public.profiles p on p.id = g.guard_id
  where g.org_id = v_org and g.site_id = p_site;
end;
$$;

comment on function public.live_positions(uuid) is
  'M3: last-known server position per guard for a site (from guard_positions). Mount-seed companion + dead-socket reconcile fallback. LIVE has_site_access check; NO audit row.';

revoke execute on function public.live_positions(uuid) from public, anon;
grant  execute on function public.live_positions(uuid) to authenticated;
