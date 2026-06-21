# TrailMe — Setup & Onboarding

This is the human checklist to go from a fresh clone to a running dashboard and
mobile dev client. Follow it top to bottom. All env var names are canonical — see
[`.env.example`](../.env.example) for the full list grouped by app.

> **Prerequisites:** Node 20 (`.nvmrc` pins it — run `nvm use`), Git, and a
> terminal. macOS or Linux recommended for the mobile builds; the dashboard runs
> anywhere.

---

## 1. Create a Supabase project (EU region)

1. Sign in at <https://supabase.com> and create a new project.
2. Pick an **EU region** (e.g. `eu-central-1` / Frankfurt) — guard location data
   is personal data, keep it in the EU.
3. Once provisioned, open **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_URL`
     (same value) and `SUPABASE_URL` (edge functions).
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
     `EXPO_PUBLIC_SUPABASE_ANON_KEY` (same value).
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`. **Server-only.** Never
     put this in a `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` var or ship it to a client.
4. PostGIS is required. It ships with Supabase; migrations enable it via
   `create extension if not exists postgis`.

## 2. Create a Mapbox account + tokens

1. Sign up at <https://account.mapbox.com>.
2. **Public token** (`pk.*`): use the **Default public token**, or create a new
   one. Set it on **both** `NEXT_PUBLIC_MAPBOX_TOKEN` (dashboard) and
   `EXPO_PUBLIC_MAPBOX_TOKEN` (mobile). Safe to expose in client bundles.
3. **Native downloads token** (`sk.*`): create a token with the
   **`DOWNLOADS:READ`** secret scope → set it on `MAPBOX_DOWNLOADS_TOKEN`. This
   is build-time only; `@rnmapbox/maps` uses it to download the native SDK during
   the EAS / native build. It is **not** bundled into the running app.

## 3. Install pnpm + dependencies

This repo is a pnpm + Turborepo monorepo. Use pnpm (not npm/yarn).

```bash
# Enable Corepack so the pinned pnpm version is used (recommended)
corepack enable

# From the repo root:
nvm use            # selects Node 20 from .nvmrc
pnpm install       # installs all workspace deps

# Set up your env file:
cp .env.example .env   # then fill in the values from steps 1 & 2
```

## 4. Link the Supabase CLI, push migrations, seed

Install the CLI if you don't have it: <https://supabase.com/docs/guides/cli>.

```bash
# Authenticate the CLI with your Supabase account
supabase login

# Link this repo to your project (find the ref in the dashboard URL or
# Project Settings → General → Reference ID):
supabase link --project-ref <your-project-ref>

# Apply the schema (organizations, sites, location_breadcrumbs, etc.):
supabase db push

# Seed reference / demo data:
supabase db seed   # or: psql "$DATABASE_URL" -f supabase/seed.sql

# Set Edge Function secrets (used by the breadcrumb ingest / device-token fns):
supabase secrets set \
  DEVICE_TOKEN_SECRET="<generate-a-long-random-string>" \
  SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"
```

> `SUPABASE_URL` is injected into Edge Functions automatically by the platform —
> you only need to set `DEVICE_TOKEN_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`.

## 5. Background-geolocation license (PAID — M2, not needed yet)

`react-native-background-geolocation` (transistorsoft) requires a **paid license
key** for production background tracking. It is set via `RN_BG_GEO_LICENSE`.

- **You do NOT need it for M0/M1.** Leave `RN_BG_GEO_LICENSE` blank for now.
- It becomes a **required** dependency at **M2**, when always-on background
  tracking is wired up. Purchase a license at
  <https://shop.transistorsoft.com> before then.

## 6. Run the apps

### Dashboard (Next.js)

```bash
pnpm --filter @trailme/dashboard dev
```

Open <http://localhost:3000>. It reads `NEXT_PUBLIC_*` vars and
`SUPABASE_SERVICE_ROLE_KEY` (server-side only).

### Mobile (Expo — EAS dev client, NOT Expo Go)

TrailMe uses native modules (`@rnmapbox/maps`,
`react-native-background-geolocation`) that **do not run in Expo Go**. You must
build and install a **dev client**.

```bash
# Install the EAS CLI (one-time):
npm install -g eas-cli
eas login

# Build a development client (needs MAPBOX_DOWNLOADS_TOKEN in your env):
eas build --profile development --platform ios     # or android

# Install the resulting build on a device/simulator, then start the bundler:
pnpm --filter @trailme/mobile start
```

Scan the QR code / open the build — it connects to the Metro bundler. Do **not**
use the Expo Go app; the native modules will be missing and the app will crash.

---

## Troubleshooting

- **Map is blank in the dashboard** → check `NEXT_PUBLIC_MAPBOX_TOKEN` is a valid
  `pk.*` token and the dev server was restarted after editing `.env`.
- **EAS build fails downloading the Mapbox SDK** → `MAPBOX_DOWNLOADS_TOKEN` is
  missing or lacks the `DOWNLOADS:READ` scope.
- **RLS denied / empty data** → confirm you're authenticated and that seed data
  created a membership row linking your user to an organization.
- **`pnpm install` resolves the wrong Node** → run `nvm use` first; this repo
  targets Node 20.
