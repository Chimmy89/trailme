# Deploying the dashboard to Vercel

Only the **Next.js dashboard** (`apps/dashboard`) deploys to Vercel. The Expo mobile
app (EAS → app stores) and the Supabase backend (hosted separately) do **not**.

## One-time: import the repo

1. <https://vercel.com/new> → import `Chimmy89/trailme`.
2. **Root Directory:** set to `apps/dashboard`. Vercel auto-detects Next.js and installs
   the pnpm workspace from the repo root (it walks up to `pnpm-workspace.yaml`).
3. **Framework preset:** Next.js (auto-detected). Leave Build/Install commands default.

## Environment variables

Add these in **Project → Settings → Environment Variables** for **Production** (and Preview).
The values are the hosted-project ones already in `apps/dashboard/.env.local` (do not commit them):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://oewqnetipqnbpzwsmsmh.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | hosted anon key (from `.env.local`) |
| `SUPABASE_SERVICE_ROLE_KEY` | hosted service_role key — **server-only**, never `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | your `pk.…` Mapbox token |

## After the first deploy

1. Copy the Vercel URL (e.g. `https://trailme.vercel.app`).
2. In **Supabase → Authentication → URL Configuration**, set **Site URL** to the Vercel URL
   and add it to **Redirect URLs** (currently `http://127.0.0.1:3000` from local dev) — otherwise
   password-reset / email links point at localhost. (`supabase config push` would overwrite this
   from `config.toml`, so update `config.toml`'s `[auth] site_url` too once the URL is stable.)
3. Log in at the Vercel URL as `kimryen@gmail.com`.

## Auto-deploy

Once connected, every push to `main` ships Production; pull requests get Preview deployments.
No further setup.
