# TrailMe M1 — pgTAP test suite

These tests prove the M1 VERIFY criteria for the breadcrumb ingest spine:
idempotent replay, timestamp integrity, accuracy filtering, gate rejection,
the two-tier retention/cron model, audit accountability, and tenant-isolation
security.

They are [pgTAP](https://pgtap.org/) tests run by the Supabase CLI's
`supabase test db`, which loads the `pgtap` extension, applies the migrations
(`0001`–`0008`) and `seed.sql`, then runs each `*_test.sql` inside its own
transaction and rolls back.

## Files

| File | Proves |
|------|--------|
| `00_helpers.sql` | Shared fixtures (a second tenant + open shifts). **Not a test** — `\i`-included by the others. |
| `01_idempotent_replay_test.sql` | A replayed batch adds no rows; dedup on `(guard_id, install_id, client_seq)`; the replay reports a per-row `duplicate` reason; the same `client_seq` under a new `install_id` (reinstall) is accepted, not falsely deduped. |
| `02_timestamp_integrity_test.sql` | A 50-min-old buffered fix keeps its **true** `captured_at` and routes to the correct daily partition. |
| `03_accuracy_filter_test.sql` | A `>50 m` fix is flagged `is_low_confidence` (kept for accountability) and excluded from a `trail_window` heatmap-style read. |
| `04_gate_rejection_test.sql` | An off-shift row is rejected per-row, reported, and lands in `dead_letter_breadcrumbs` — never silently dropped. |
| `05_retention_cron_test.sql` | `drop_aged_partitions` drops a past-90-day partition (not a recent one); `purge_expired_breadcrumbs` purges a 7-day org's old rows but **not** a 90-day co-tenant's same-age rows, AND purges an expired row that landed in the DEFAULT partition (90d-tier storage-limitation hole closed); a 10-day-old fix routes to a real daily partition; `auto_close_forgotten_shifts` closes a stale shift. |
| `06_audit_test.sql` | `trail_window` writes a `trail_window_read` audit row; `audit_log` UPDATE/DELETE are forbidden (append-only); a settings change writes a `settings_change` row. |
| `07_security_test.sql` | The access-token hook never elevates role; a cross-org `SELECT` on `location_breadcrumbs` returns 0 rows; a forged cross-org ingest row is rejected by the RPC's membership re-verify. |

## Prerequisites

- Supabase CLI installed (`supabase --version`).
- A local stack: `supabase start` (Postgres 15 + PostGIS + `pg_cron` per
  `supabase/config.toml`). The migrations install `pgtap` is **not** required in
  the migrations — the CLI's `test db` command loads `pgtap` into the test
  database itself.

## Running

From the repo root:

```bash
# Apply migrations + seed into a fresh test DB and run every *_test.sql.
supabase test db
```

To run a single file while iterating:

```bash
supabase test db --file supabase/tests/01_idempotent_replay_test.sql
```

> The `\i supabase/tests/00_helpers.sql` includes assume the CLI runs with the
> repo root as the working directory (the default for `supabase test db`). If you
> invoke `pg_prove`/`psql` manually from another directory, adjust the include
> path or `cd` to the repo root first.

## Running manually with pg_prove (optional)

If you prefer `pg_prove` directly against an already-migrated database:

```bash
# pgTAP must be present in the target DB:
psql "$DATABASE_URL" -c 'create extension if not exists pgtap;'

# Run from the repo root so the \i include paths resolve:
pg_prove --ext .sql -d "$DATABASE_URL" supabase/tests/0*_test.sql
```

## Notes on isolation

- Every test wraps its work in `begin … rollback`, so they leave no residue and
  can run in any order against the seeded database.
- Tests that exercise RLS impersonate a user by `set local role authenticated`
  plus a `request.jwt.claims` GUC carrying the `sub` (user id); `auth.uid()`
  reads that claim. They switch back to `postgres`/`migration` role for
  privileged setup. This mirrors how PostgREST sets the role + claims per
  request.
- `05_retention_cron_test.sql` calls the cron **functions** directly
  (`drop_aged_partitions`, `purge_expired_breadcrumbs`, `auto_close_forgotten_shifts`)
  rather than waiting on the `pg_cron` schedule — the schedule is just a
  thin wrapper proven by `0008`'s `cron.schedule` calls.
