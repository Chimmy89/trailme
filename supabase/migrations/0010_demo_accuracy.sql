-- 0010_demo_accuracy.sql
-- DEMO mode now filters GPS on the sharer's device (Kalman) and pushes the
-- FILTERED position + its honest 1-σ accuracy, so the stored breadcrumbs (and
-- therefore every viewer's peer dots/trails) are clean at the source.
--
-- Add an optional p_accuracy to demo_push_position; store coalesce(p_accuracy, 5)
-- instead of the hardcoded 5 m. Backward-compatible: the 2-arg call style still
-- resolves to this function via the default. demo_live_map is unchanged.

drop function if exists public.demo_push_position(double precision, double precision);

create or replace function public.demo_push_position(
  p_lat double precision,
  p_lon double precision,
  p_accuracy double precision default null
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
  v_acc   double precision := greatest(coalesce(p_accuracy, 5), 1);
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

  insert into public.location_breadcrumbs (
    org_id, guard_id, install_id, site_id, geom, captured_at, partition_ts,
    client_seq, accuracy_m, is_keepalive, is_low_confidence
  )
  values (
    v_org, v_uid, v_uid, v_site, v_geom, now(), date_trunc('day', now()),
    floor(extract(epoch from clock_timestamp()) * 1000)::bigint, v_acc, false, false
  )
  on conflict (guard_id, install_id, client_seq, partition_ts) do nothing;

  insert into public.guard_positions (
    org_id, guard_id, site_id, geom, captured_at, accuracy_m, online, updated_at
  )
  values (v_org, v_uid, v_site, v_geom, now(), v_acc, true, now())
  on conflict (guard_id) do update
    set geom = excluded.geom, site_id = excluded.site_id,
        captured_at = excluded.captured_at, online = true, updated_at = now();
end;
$$;

comment on function public.demo_push_position(double precision, double precision, double precision) is
  'DEMO-ONLY: an authenticated user pushes a device-filtered GPS fix (lat, lon, accuracy). Bypasses the production device-token ingest path. Drop when the native app is live.';

revoke execute on function public.demo_push_position(double precision, double precision, double precision) from public, anon;
grant  execute on function public.demo_push_position(double precision, double precision, double precision) to authenticated;
