-- 0004_access_token_hook.sql
-- TrailMe M0 — Custom Access Token Hook.
--
-- Registered in config.toml as:
--   [auth.hook.custom_access_token]
--   uri = "pg-functions://postgres/public/custom_access_token_hook"
--
-- The hook runs inside GoTrue as the `supabase_auth_admin` role on every token
-- issuance (login AND refresh). It stamps the caller's LIVE org_id / role /
-- site_ids into app_metadata so the hot-path RLS can use constant-time claims,
-- while sensitive cross-guard reads still re-verify against memberships.
--
-- =====================  INVARIANTS (tested in M1)  =========================
-- 1. NEVER ELEVATES ROLE. The role written to app_metadata.role is read
--    verbatim from the user's single active memberships row. There is no code
--    path that promotes 'guard' → 'supervisor'/'org_admin'. A user with no
--    active membership gets NO org_id/role/site_ids stamped at all (the keys
--    are removed), so RLS — which keys off authz.* live lookups returning NULL
--    — denies. The hook cannot grant more than the membership row already says.
-- 2. FAILS CLOSED. The membership read is wrapped so that ANY error (missing
--    table grant, unexpected exception) RAISES rather than returning a token.
--    A raised hook makes GoTrue reject the login — we lock the user out rather
--    than issue a token with stale or absent authorization claims. We never
--    return the original event "to be safe": that would hand back a token whose
--    app_metadata might carry attacker-controlled or stale claims.
-- 3. NULL-SAFE. Missing app_metadata, missing membership, empty site_ids are
--    all handled explicitly; no NULL dereference can crash the hook into an
--    ambiguous state.
-- 4. IGNORES user_metadata. Authorization is sourced ONLY from memberships
--    (server-controlled). raw_user_meta_data is user-editable and is never read.
-- ===========================================================================

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id   uuid;
  v_claims    jsonb;
  v_org_id    uuid;
  v_role      public.membership_role;
  v_site_ids  uuid[];
begin
  -- event.user_id and event.claims are guaranteed present by GoTrue's schema,
  -- but we read defensively.
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := coalesce(event -> 'claims', '{}'::jsonb);

  -- Ensure app_metadata exists so jsonb_set has an object to write into.
  if v_claims -> 'app_metadata' is null
     or jsonb_typeof(v_claims -> 'app_metadata') <> 'object' then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;

  -- LIVE authority lookup. One active membership per user (MVP UNIQUE(user_id)).
  select m.org_id, m.role, m.site_ids
    into v_org_id, v_role, v_site_ids
  from public.memberships m
  where m.user_id = v_user_id
    and m.active
  limit 1;

  if v_org_id is null then
    -- No active membership → stamp NO authorization claims. Remove any that a
    -- previous token state might have carried so a deactivated user cannot
    -- retain elevated claims across a refresh. RLS then denies (authz.* → NULL).
    v_claims := jsonb_set(
      v_claims, '{app_metadata}',
      (v_claims -> 'app_metadata') - 'org_id' - 'role' - 'site_ids'
    );
  else
    -- Stamp claims VERBATIM from the membership row. Role is never elevated.
    v_claims := jsonb_set(v_claims, '{app_metadata,org_id}',  to_jsonb(v_org_id::text));
    v_claims := jsonb_set(v_claims, '{app_metadata,role}',    to_jsonb(v_role::text));
    v_claims := jsonb_set(
      v_claims, '{app_metadata,site_ids}',
      to_jsonb(coalesce(v_site_ids, '{}'::uuid[]))
    );
  end if;

  return jsonb_set(event, '{claims}', v_claims);

exception
  when others then
    -- FAIL CLOSED: never return a token on error. Raising rejects the login.
    raise exception 'custom_access_token_hook failed for user %, denying token: %',
      v_user_id, sqlerrm;
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Stamps app_metadata.org_id/role/site_ids from the LIVE memberships row. Never elevates role; fails closed on error (raises → login rejected). See header for invariants (tested M1).';

-- ===========================================================================
-- Grants. GoTrue invokes the hook as `supabase_auth_admin`. That role must be
-- able to EXECUTE the function and SELECT the memberships table it reads. We
-- grant the NARROWEST surface (SELECT on memberships only) and revoke the
-- function from application roles so it is callable only by the auth server.
-- ===========================================================================
grant usage  on schema public                              to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table public.memberships                   to supabase_auth_admin;

revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
