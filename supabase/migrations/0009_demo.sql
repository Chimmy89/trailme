-- 0009_demo.sql
-- DEMO-ONLY support for the browser "Share my location" mode, so the product can
-- be shown on phones today WITHOUT the native field app (which needs the paid
-- transistorsoft license + an EAS build). This is a deliberate shortcut around
-- the production device-token ingest path (mint-device-token -> ingest-breadcrumbs
-- -> batch_insert_breadcrumbs). Safe to DROP once the native app is live.
--
--   demo_push_position(lat, lon) — an authenticated user pushes their own browser
--     GPS fix: auto-opens a shift if needed (so the tracking gate admits it),
--     inserts a breadcrumb (builds the trail), and upserts guard_positions.
--   demo_live_map(minutes)        — returns the org's decimated recent breadcrumbs
--     with lat/lon + each guard's display name/color, for rendering live markers
--     and per-guard trails on the web map. (No audit row — demo aggregate read.)

-- ===========================================================================
create or replace function public.demo_push_position(
  p_lat double precision,
  p_lon double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid := authz.org_id();
  v_site  uuid;
  v_geom  extensions.geography(Point, 4326);
  v_shift uuid;
begin
  if v_uid is null or v_org is null then
    raise exception 'demo_push_position: not authenticated' using errcode = 'P0001';
  end if;

  -- the guard's first assigned site, else the org's first site
  select coalesce(
           (select (m.site_ids)[1] from public.memberships m
              where m.user_id = v_uid and m.active and array_length(m.site_ids, 1) > 0 limit 1),
           (select s.id from public.sites s where s.org_id = v_org order by s.created_at limit 1)
         ) into v_site;
  if v_site is null then
    raise exception 'demo_push_position: no site for org' using errcode = 'P0001';
  end if;

  -- ensure an open shift so enforce_tracking_gate() admits the breadcrumb
  select id into v_shift from public.shifts
   where guard_id = v_uid and clock_out is null limit 1;
  if v_shift is null then
    insert into public.shifts (org_id, guard_id, site_id, clock_in)
    values (v_org, v_uid, v_site, now());
  end if;

  v_geom := extensions.st_setsrid(extensions.st_makepoint(p_lon, p_lat), 4326)::extensions.geography;

  -- install_id = guard id (demo); client_seq = epoch ms (monotonic, unique per fix)
  insert into public.location_breadcrumbs (
    org_id, guard_id, install_id, site_id, geom, captured_at, partition_ts,
    client_seq, accuracy_m, is_keepalive, is_low_confidence
  )
  values (
    v_org, v_uid, v_uid, v_site, v_geom, now(), date_trunc('day', now()),
    floor(extract(epoch from clock_timestamp()) * 1000)::bigint, 5, false, false
  )
  on conflict (guard_id, install_id, client_seq, partition_ts) do nothing;

  insert into public.guard_positions (
    org_id, guard_id, site_id, geom, captured_at, accuracy_m, online, updated_at
  )
  values (v_org, v_uid, v_site, v_geom, now(), 5, true, now())
  on conflict (guard_id) do update
    set geom = excluded.geom, site_id = excluded.site_id,
        captured_at = excluded.captured_at, online = true, updated_at = now();
end;
$$;

comment on function public.demo_push_position(double precision, double precision) is
  'DEMO-ONLY: an authenticated user pushes a browser GPS fix (auto-shift + breadcrumb + position). Bypasses the production device-token ingest path. Drop when the native app is live.';

revoke execute on function public.demo_push_position(double precision, double precision) from public, anon;
grant  execute on function public.demo_push_position(double precision, double precision) to authenticated;

-- ===========================================================================
create or replace function public.demo_live_map(p_minutes int default 15)
returns table (
  guard_id     uuid,
  display_name text,
  color        text,
  lat          double precision,
  lon          double precision,
  captured_at  timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := authz.org_id();
begin
  if v_org is null then
    raise exception 'demo_live_map: no org' using errcode = 'P0001';
  end if;
  if p_minutes not in (5, 10, 15, 30, 60, 120) then
    p_minutes := 15;
  end if;

  return query
  with raw as (
    select b.guard_id, b.geom, b.captured_at,
           date_bin(interval '5 seconds', b.captured_at, timestamptz 'epoch') as bucket
    from public.location_breadcrumbs b
    where b.org_id = v_org
      and b.captured_at >= now() - make_interval(mins => p_minutes)
      and b.is_low_confidence = false
      and b.is_keepalive = false
  ),
  decimated as (
    select distinct on (raw.guard_id, raw.bucket)
           raw.guard_id, raw.geom, raw.captured_at
    from raw
    order by raw.guard_id, raw.bucket, raw.captured_at desc
  )
  -- LEFT JOIN: a guard with breadcrumbs but no profiles row (e.g. signed up
  -- outside the seed, no profile-on-signup trigger) must still show on the map,
  -- with a sensible fallback name/colour rather than vanishing.
  select d.guard_id,
         coalesce(p.display_name, 'Guard') as display_name,
         coalesce(p.color, '#3b82f6')      as color,
         extensions.st_y(d.geom::extensions.geometry) as lat,
         extensions.st_x(d.geom::extensions.geometry) as lon,
         d.captured_at
  from decimated d
  left join public.profiles p on p.id = d.guard_id
  order by d.guard_id, d.captured_at;
end;
$$;

comment on function public.demo_live_map(int) is
  'DEMO-ONLY: org-wide decimated recent breadcrumbs (lat/lon + guard name/color) for rendering live markers + trails on the web map. No audit row.';

revoke execute on function public.demo_live_map(int) from public, anon;
grant  execute on function public.demo_live_map(int) to authenticated;
