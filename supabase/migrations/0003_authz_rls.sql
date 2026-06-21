-- 0003_authz_rls.sql
-- TrailMe M0 — authorization helpers + Row Level Security.
--
-- Two layers:
--   (1) authz.* SECURITY DEFINER helpers that do a LIVE membership lookup
--       (NOT JWT-only) so a reassigned/removed user loses access immediately,
--       not after the 1h token TTL.
--   (2) FORCE RLS + tenant-isolation policies on every tenant table. A
--       cross-org SELECT returns zero rows.
--
-- Helpers live in the PRIVATE `authz` schema (not exposed via the Data API) and
-- are SECURITY DEFINER so they can read `memberships` regardless of the caller's
-- own RLS — they encapsulate the trust boundary. They are STABLE (one consistent
-- snapshot per statement) and set an explicit empty search_path to prevent
-- search-path injection against a SECURITY DEFINER function.

-- ===========================================================================
-- authz.org_id() — the caller's org, resolved LIVE from memberships by auth.uid().
-- Returns NULL when the caller has no active membership (→ policies deny).
-- ===========================================================================
create or replace function authz.org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.active
  limit 1;
$$;

comment on function authz.org_id() is 'Caller''s org_id via LIVE active-membership lookup. NULL if none (policies then deny).';

-- ===========================================================================
-- authz.has_role(text) — true iff the caller holds the given role in their
-- active membership. Used for org_admin-only writes (org_settings).
-- ===========================================================================
create or replace function authz.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = (select auth.uid())
      and m.active
      and m.role::text = p_role
  );
$$;

comment on function authz.has_role(text) is 'True iff caller''s LIVE active membership holds p_role.';

-- ===========================================================================
-- authz.has_site_access(uuid) — true iff the site belongs to the caller's org
-- AND (the caller is org_admin/supervisor, OR the site is in their LIVE
-- site_ids). Gates realtime channel join (M3) and trail_window (M4). LIVE check
-- closes the stale-JWT-site_ids reassignment window.
-- ===========================================================================
create or replace function authz.has_site_access(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.sites s on s.org_id = m.org_id
    where m.user_id = (select auth.uid())
      and m.active
      and s.id = p_site_id
      and (
        -- org-wide roles see every site in their org
        m.role in ('org_admin', 'supervisor')
        -- guards only see sites they are LIVE-assigned to
        or p_site_id = any (m.site_ids)
      )
  );
$$;

comment on function authz.has_site_access(uuid) is 'LIVE site-level authorization. org_admin/supervisor see all org sites; guards see assigned sites only.';

-- Application roles need EXECUTE on the helpers (they own no rows themselves —
-- the SECURITY DEFINER context reads memberships).
grant execute on function authz.org_id()                to authenticated, service_role;
grant execute on function authz.has_role(text)          to authenticated, service_role;
grant execute on function authz.has_site_access(uuid)   to authenticated, service_role;

-- ===========================================================================
-- Enable + FORCE RLS on every tenant table. FORCE ensures even the table owner
-- (and SECURITY DEFINER functions running as owner) is subject to policies,
-- closing the "owner bypasses RLS" hole.
-- ===========================================================================
alter table public.organizations    enable row level security;
alter table public.organizations    force row level security;
alter table public.org_settings      enable row level security;
alter table public.org_settings      force row level security;
alter table public.sites             enable row level security;
alter table public.sites             force row level security;
alter table public.profiles          enable row level security;
alter table public.profiles          force row level security;
alter table public.memberships       enable row level security;
alter table public.memberships       force row level security;
alter table public.guard_disclosures enable row level security;
alter table public.guard_disclosures force row level security;

-- ===========================================================================
-- organizations — members read their own org; only org_admin renames it.
-- (Org creation is an atomic SECURITY DEFINER RPC in M5, so no INSERT policy.)
-- ===========================================================================
create policy organizations_select_own
  on public.organizations for select to authenticated
  using (id = authz.org_id());

create policy organizations_update_admin
  on public.organizations for update to authenticated
  using (id = authz.org_id() and authz.has_role('org_admin'))
  with check (id = authz.org_id() and authz.has_role('org_admin'));

-- ===========================================================================
-- org_settings — readable by any member; writable ONLY by org_admin.
-- (UPDATE needs both USING and WITH CHECK — a missing USING silently returns 0
-- rows; a missing WITH CHECK would let an admin rewrite org_id.)
-- ===========================================================================
create policy org_settings_select_member
  on public.org_settings for select to authenticated
  using (org_id = authz.org_id());

create policy org_settings_insert_admin
  on public.org_settings for insert to authenticated
  with check (org_id = authz.org_id() and authz.has_role('org_admin'));

create policy org_settings_update_admin
  on public.org_settings for update to authenticated
  using (org_id = authz.org_id() and authz.has_role('org_admin'))
  with check (org_id = authz.org_id() and authz.has_role('org_admin'));

-- ===========================================================================
-- sites — members read their org's sites; org_admin manages them.
-- ===========================================================================
create policy sites_select_member
  on public.sites for select to authenticated
  using (org_id = authz.org_id());

create policy sites_insert_admin
  on public.sites for insert to authenticated
  with check (org_id = authz.org_id() and authz.has_role('org_admin'));

create policy sites_update_admin
  on public.sites for update to authenticated
  using (org_id = authz.org_id() and authz.has_role('org_admin'))
  with check (org_id = authz.org_id() and authz.has_role('org_admin'));

create policy sites_delete_admin
  on public.sites for delete to authenticated
  using (org_id = authz.org_id() and authz.has_role('org_admin'));

-- ===========================================================================
-- profiles — a user reads/writes only their own profile row. Peer display data
-- (name/color for the roster) is surfaced via a SECURITY DEFINER read in M3,
-- not a broad SELECT policy, keeping minimization tight.
-- ===========================================================================
create policy profiles_select_self
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ===========================================================================
-- memberships — a user reads ONLY their own membership row. Roster/admin views
-- of all members go through SECURITY DEFINER RPCs (M5). This is what makes a
-- cross-org SELECT return zero rows. No client write policy: membership changes
-- flow through invite/join-code/offboarding RPCs only.
-- ===========================================================================
create policy memberships_select_self
  on public.memberships for select to authenticated
  using (user_id = (select auth.uid()));

-- ===========================================================================
-- guard_disclosures — a guard reads their own acceptances and can INSERT their
-- own (the pre-tracking acknowledgement). Append-only: no UPDATE/DELETE policy.
-- ===========================================================================
create policy guard_disclosures_select_self
  on public.guard_disclosures for select to authenticated
  using (user_id = (select auth.uid()));

create policy guard_disclosures_insert_self
  on public.guard_disclosures for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and org_id = authz.org_id()
  );
