-- 0011_realtime_authz_relay.sql
-- M3 live positions — private per-site Realtime channels + server-stamped broadcast relay.
--
-- Design A (DB trigger, not an edge fn): a trigger on guard_positions calls
-- realtime.send to broadcast each server-stamped position to the site channel.
-- No pg_net / pg_cron / edge function. relay-positions stays stubbed as the
-- documented consolidated-broadcast path for hundreds-of-guards-per-site scale.
--
-- Three parts:
--   1. authz.realtime_site_id(topic) — fail-closed parser of a "site:{uuid}" topic.
--   2. RLS on realtime.messages — authorize private "site:{uuid}" channels by LIVE
--      has_site_access: broadcast RECEIVE (select), presence READ (select),
--      presence TRACK (insert). DELIBERATELY no broadcast-INSERT policy — clients
--      can never publish a position, so a guard cannot move a peer's marker; the
--      server (relay trigger, SECURITY DEFINER) is the sole publisher. (M3 verify c.)
--   3. broadcast_guard_position() — AFTER INSERT/UPDATE trigger that broadcasts the
--      SERVER-STAMPED row (lat/lon/heading/online + name/color) to site:{site_id}.

-- 1. Topic parser ------------------------------------------------------------
-- Returns the uuid from a 'site:{uuid}' topic, else NULL. NULL flows into
-- has_site_access(NULL) -> false, so a malformed/forged topic fails CLOSED. The
-- regex guards the cast so an attacker-controlled suffix never reaches ::uuid
-- (a bad cast would raise inside the policy and break channel joins).
create or replace function authz.realtime_site_id(p_topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_topic ~ '^site:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then substring(p_topic from 6)::uuid
    else null
  end;
$$;

grant execute on function authz.realtime_site_id(text) to authenticated;

-- 2. realtime.messages RLS (Supabase pre-enables RLS on this table) -----------
-- broadcast RECEIVE: read 'pos' ticks on site:{id} only for a LIVE-accessible site.
create policy trailme_site_broadcast_receive
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and authz.has_site_access(authz.realtime_site_id((select realtime.topic())))
  );

-- presence READ: the roster, same site gate.
create policy trailme_site_presence_read
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'presence'
    and authz.has_site_access(authz.realtime_site_id((select realtime.topic())))
  );

-- presence TRACK: a client publishes only its OWN presence, on an accessible site.
create policy trailme_site_presence_track
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and authz.has_site_access(authz.realtime_site_id((select realtime.topic())))
  );

-- (No INSERT policy for extension='broadcast': clients cannot publish positions.)

-- 3. Relay trigger -----------------------------------------------------------
create or replace function public.broadcast_guard_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name  text;
  v_color text;
begin
  -- name/color travel with the tick so subscribers render without reading profiles
  -- (profiles RLS is self-only on the client).
  select p.display_name, p.color into v_name, v_color
  from public.profiles p where p.id = new.guard_id;

  perform realtime.send(
    jsonb_build_object(
      'guard_id',     new.guard_id,
      'site_id',      new.site_id,
      'display_name', v_name,
      'color',        v_color,
      'lat',          extensions.st_y(new.geom::extensions.geometry),
      'lon',          extensions.st_x(new.geom::extensions.geometry),
      'heading',      new.heading,
      'accuracy_m',   new.accuracy_m,
      'online',       new.online,
      'captured_at',  new.captured_at
    ),
    'pos',                          -- event
    'site:' || new.site_id::text,   -- topic  (matches the client channel name)
    true                            -- PRIVATE — explicit; never rely on the default
  );
  return null; -- AFTER trigger; return value ignored
end;
$$;

comment on function public.broadcast_guard_position() is
  'M3: broadcasts a server-stamped guard position to the private site:{id} Realtime channel on every guard_positions write. Identity is the row''s guard_id (set by SECURITY DEFINER writers), never client-supplied.';

create trigger trg_broadcast_guard_position
  after insert or update on public.guard_positions
  for each row execute function public.broadcast_guard_position();
