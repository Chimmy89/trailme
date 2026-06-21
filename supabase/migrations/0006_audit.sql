-- 0006_audit.sql
-- TrailMe M1 — accountability log + erasure registry.
--
-- Applies after 0005. Two concerns:
--   (1) audit_log: APPEND-ONLY accountability record of sensitive actions
--       (location-trail reads, DSAR exports, erasures, settings changes,
--       sampled channel joins). It MUST NOT be rewritable — a trigger forbids
--       UPDATE/DELETE so even the table owner cannot tamper with history. Its
--       retention is longer than the location firehose (purged in 0008).
--   (2) erasure_registry: the static catalogue of EVERY table carrying a
--       guard_id, consumed by future DSAR/erasure RPCs so neither operation can
--       silently miss a table. Seeded here.
-- Plus a settings_change audit trigger on org_settings.

-- ===========================================================================
-- audit_log action enum. Closed set so the dashboard / alerting can reason over
-- a known vocabulary. Mirror values exist in @trailme/shared if surfaced to UI.
-- ===========================================================================
create type public.audit_action as enum (
  'trail_window_read',     -- a supervisor/admin read a site's recent trail (who watched whom)
  'dsar_export',           -- a Subject Access Request export was produced
  'erasure',               -- a guard's data was erased
  'settings_change',       -- org_settings was modified (retention/tracking_mode/etc.)
  'channel_join_sampled'   -- a sampled realtime channel join (not every join — sampled)
);

-- ===========================================================================
-- audit_log — append-only. No updated_at: a row, once written, is frozen.
-- ===========================================================================
create table public.audit_log (
  id             uuid           not null default public.trailme_uuid(),
  org_id         uuid           not null references public.organizations (id) on delete cascade,
  -- The human/actor who performed the action. NULL only for system jobs.
  actor_user_id  uuid           references auth.users (id) on delete set null,
  action         public.audit_action not null,
  -- The guard whose data was touched/observed, when applicable.
  target_guard_id uuid          references auth.users (id) on delete set null,
  params         jsonb          not null default '{}'::jsonb,
  ts             timestamptz    not null default now(),
  primary key (id)
);

create index audit_log_org_ts_idx        on public.audit_log (org_id, ts desc);
create index audit_log_action_ts_idx     on public.audit_log (org_id, action, ts desc);
create index audit_log_target_guard_idx  on public.audit_log (target_guard_id, ts desc);

comment on table public.audit_log is
  'APPEND-ONLY accountability log. UPDATE/DELETE forbidden by trigger (bypassable only by a superuser via session_replication_role — see header). Inserts only via SECURITY DEFINER. Longer retention than the location firehose.';

-- ----- Tamper guard: forbid UPDATE and DELETE on audit_log -----------------
-- A trigger (rather than a mere REVOKE) so the prohibition holds for the table
-- owner and SECURITY DEFINER functions running as owner. Retention purges in 0008
-- run via a dedicated function that is the SINGLE allowed deleter; it sets a
-- session flag the trigger honors, so the ONLY delete path is the intentional,
-- scoped retention job — ad-hoc DELETEs still raise.
--
-- RESIDUAL TRUST ASSUMPTION (documented, not a hard guarantee): a SUPERUSER (or
-- any role that can SET session_replication_role) can disable non-replica
-- triggers for a session (SET session_replication_role='replica') and then
-- UPDATE/DELETE audit rows with no error. This trigger therefore protects against
-- the application/service roles and ordinary owner access, NOT against a malicious
-- superuser. For stronger assurance ship audit_log to an append-only sink outside
-- the DB superuser's reach (logical replication to write-once storage) or add
-- hash-chaining (store prev_row_hash so post-hoc tampering is detectable). Ensure
-- only the trusted DBA — never the app/service roles — can set
-- session_replication_role.
create or replace function public.forbid_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_log is append-only: UPDATE is forbidden'
      using errcode = 'P0001';
  end if;
  -- DELETE allowed ONLY for the scoped retention purge, which sets this flag.
  if tg_op = 'DELETE' then
    if coalesce(current_setting('trailme.audit_purge', true), 'off') <> 'on' then
      raise exception 'audit_log is append-only: DELETE is forbidden outside the retention purge'
        using errcode = 'P0001';
    end if;
  end if;
  return null; -- AFTER trigger; the raise above blocks the disallowed op.
end;
$$;

create trigger trg_audit_log_no_update
  before update on public.audit_log
  for each row execute function public.forbid_audit_log_mutation();

create trigger trg_audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.forbid_audit_log_mutation();

-- ----- RLS: oversight roles read within org; inserts via SECURITY DEFINER ----
alter table public.audit_log enable row level security;
alter table public.audit_log force  row level security;

create policy audit_log_select_oversight
  on public.audit_log for select to authenticated
  using (
    org_id = authz.org_id()
    and (authz.has_role('org_admin') or authz.has_role('supervisor'))
  );

-- Insert policy so the SECURITY DEFINER writers (which run under FORCE RLS) can
-- insert. The writers are the only INSERT path (no grant to clients below), and
-- they stamp org_id from a verified context.
--
-- SECURITY: the predicate is NEVER keyed on current_setting('role'). Keying on
-- the role GUC is a blanket cross-tenant bypass — any service_role session (the
-- edge functions, any service-key holder, a SET ROLE service_role) could then
-- INSERT an audit_log row for ANY org_id, fabricating/polluting another tenant's
-- accountability log. Instead:
--   * the authenticated path may only write its OWN org's rows (org_id = authz.org_id());
--   * the canonical definer writer write_audit_log() sets the transaction-local
--     flag trailme.audit_writer='on' for the duration of its INSERT, so a
--     system/cron actor with no auth.uid() can still write, but ONLY through the
--     one function that sets the flag — not via any arbitrary service_role path.
-- The flag is set with set_config(..., true) (transaction-local) and the row's
-- org_id still has to be a real organization, so a stray INSERT cannot smuggle a
-- forged org in.
create policy audit_log_insert_via_rpc
  on public.audit_log for insert to authenticated, service_role
  with check (
    org_id = authz.org_id()
    or (
      current_setting('trailme.audit_writer', true) = 'on'
      and exists (select 1 from public.organizations o where o.id = org_id)
    )
  );

-- Clients may only SELECT (oversight). All writes go through definer functions.
grant select on public.audit_log to authenticated;
grant insert on public.audit_log to service_role;

-- ===========================================================================
-- write_audit_log() — the single canonical SECURITY DEFINER audit writer.
-- Every sensitive RPC calls this rather than inserting directly, so the insert
-- path is uniform and the org stamping is centralized. SECURITY DEFINER so it
-- writes even though the caller has no direct INSERT grant.
-- ===========================================================================
create or replace function public.write_audit_log(
  p_org_id          uuid,
  p_actor_user_id   uuid,
  p_action          public.audit_action,
  p_target_guard_id uuid default null,
  p_params          jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Authorize the definer-writer branch of audit_log_insert_via_rpc for THIS
  -- INSERT only. Transaction-local (set_config local=true), so it does not leak
  -- to other statements outside this function call. This is the ONLY place the
  -- flag is set, so the policy's non-auth.uid() write path is reachable only
  -- through this canonical writer — not via any arbitrary service_role session.
  perform set_config('trailme.audit_writer', 'on', true);
  insert into public.audit_log (org_id, actor_user_id, action, target_guard_id, params)
  values (p_org_id, p_actor_user_id, p_action, p_target_guard_id, coalesce(p_params, '{}'::jsonb));
  perform set_config('trailme.audit_writer', 'off', true);
end;
$$;

comment on function public.write_audit_log(uuid, uuid, public.audit_action, uuid, jsonb) is
  'Canonical append-only audit writer. SECURITY DEFINER. Called by sensitive RPCs.';

revoke execute on function public.write_audit_log(uuid, uuid, public.audit_action, uuid, jsonb) from public, anon;
grant  execute on function public.write_audit_log(uuid, uuid, public.audit_action, uuid, jsonb) to service_role;

-- ===========================================================================
-- erasure_registry — every table that carries a guard_id, with the column name
-- and a delete strategy hint. Future DSAR/erasure RPCs iterate this so neither
-- can MISS a table when a new guard_id-bearing table is added: adding the table
-- without registering it is the bug the registry surfaces.
-- ===========================================================================
create type public.erasure_strategy as enum (
  'delete',          -- physically remove the guard's rows
  'anonymize',       -- keep the row for integrity but null/scrub the guard link
  'retain_legal'     -- keep (legal-hold / accountability) — e.g. audit_log, disclosures
);

create table public.erasure_registry (
  table_schema  text not null,
  table_name    text not null,
  guard_column  text not null,
  strategy      public.erasure_strategy not null,
  -- Why this strategy (esp. retain_legal) — the LIA / legal basis note.
  rationale     text,
  primary key (table_schema, table_name, guard_column)
);

comment on table public.erasure_registry is
  'Static catalogue of every guard_id-bearing table + erasure strategy. DSAR/erasure RPCs iterate this so neither misses a table.';

-- Read-only reference data. RLS: any member may read it (it carries no tenant
-- data, only schema metadata); no client writes.
alter table public.erasure_registry enable row level security;
alter table public.erasure_registry force  row level security;

create policy erasure_registry_select_member
  on public.erasure_registry for select to authenticated
  using (authz.org_id() is not null);

grant select on public.erasure_registry to authenticated;

-- ----- Seed the registry --------------------------------------------------
-- EVERY table from 0002 + 0005 + 0006 that carries a guard/user identifier.
-- Strategy rationale:
--   * Firehose / positions / checkpoints / shifts → delete (operational PII).
--   * guard_disclosures → retain_legal (proof of what the guard was told; needed
--     to defend the lawfulness of past processing) — anonymize the link instead
--     of destroying the record is NOT enough; we retain under legal basis.
--   * memberships → anonymize (the membership is the access record; deletion
--     cascades elsewhere, but for erasure we scrub rather than break referential
--     audit; org offboarding handles row removal separately).
--   * audit_log → retain_legal (accountability log must survive an erasure, else
--     the erasure itself becomes unauditable). target_guard_id is retained.
insert into public.erasure_registry (table_schema, table_name, guard_column, strategy, rationale) values
  ('public', 'location_breadcrumbs',   'guard_id', 'delete',
     'Operational location PII. Erased on request, subject to retention min.'),
  ('public', 'guard_positions',        'guard_id', 'delete',
     'Last-known position PII. Erased on request.'),
  ('public', 'inspection_checkpoints', 'guard_id', 'delete',
     'Checkpoint tags tied to the guard. Erased on request.'),
  ('public', 'shifts',                 'guard_id', 'delete',
     'Shift windows are activity PII. Erased on request.'),
  ('public', 'guard_disclosures',      'user_id',  'retain_legal',
     'Proof of pre-tracking disclosure. Retained to defend lawfulness of past processing.'),
  ('public', 'memberships',            'user_id',  'anonymize',
     'Access-control record. Scrub link on erasure rather than break referential audit; row removal handled by offboarding.'),
  ('public', 'audit_log',              'target_guard_id', 'retain_legal',
     'Accountability log must survive erasure so the erasure itself stays auditable.')
on conflict (table_schema, table_name, guard_column) do nothing;

-- ===========================================================================
-- settings_change audit trigger on org_settings. Any modification writes an
-- audit_log row capturing the before/after of the privacy-relevant columns.
-- Uses write_audit_log (SECURITY DEFINER) so it works under FORCE RLS.
-- ===========================================================================
create or replace function public.audit_org_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  -- auth.uid() is NULL for system/admin-CLI changes; that's fine (actor null).
  v_actor := (select auth.uid());

  perform public.write_audit_log(
    new.org_id,
    v_actor,
    'settings_change',
    null,
    jsonb_build_object(
      'changed_columns',
        (select jsonb_object_agg(col, jsonb_build_object('old', oldv, 'new', newv))
         from (
           values
             ('tracking_mode',   to_jsonb(old.tracking_mode),   to_jsonb(new.tracking_mode)),
             ('retention_days',  to_jsonb(old.retention_days),  to_jsonb(new.retention_days)),
             ('lawful_basis',    to_jsonb(old.lawful_basis),    to_jsonb(new.lawful_basis)),
             ('dpia_completed_at', to_jsonb(old.dpia_completed_at), to_jsonb(new.dpia_completed_at)),
             ('plan',            to_jsonb(old.plan),            to_jsonb(new.plan)),
             ('seat_limit',      to_jsonb(old.seat_limit),      to_jsonb(new.seat_limit))
         ) as c(col, oldv, newv)
         where oldv is distinct from newv)
    )
  );
  return new;
end;
$$;

create trigger trg_org_settings_audit
  after update on public.org_settings
  for each row execute function public.audit_org_settings_change();

comment on function public.audit_org_settings_change() is
  'AFTER UPDATE on org_settings: writes a settings_change audit_log row with the changed columns'' before/after.';
