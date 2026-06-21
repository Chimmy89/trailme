// supabase/functions/mint-device-token/index.ts
//
// TrailMe M1 — device-ingest token minter.
//
// Called by the mobile app AFTER a successful interactive (1h) login. It:
//   - verifies the caller's interactive Supabase session (Authorization:
//     Bearer <access_token>) by resolving the user with the service client;
//   - reads the user's LIVE active membership (org_id / role / site_ids) — the
//     server-controlled authority, NOT the JWT's app_metadata copy;
//   - reads the device-supplied install_id (a per-install UUID the client posts
//     in the request body) and binds it into the token so ingest can attach it
//     authoritatively to every fix (idempotency epoch across reinstalls);
//   - mints a dedicated, longer-lived (~24h) DEVICE-scoped JWT signed with
//     DEVICE_TOKEN_SECRET carrying { org_id, guard_id, site_ids, install_id,
//     kind:'device' } (see @trailme/shared DeviceTokenClaimsSchema), returns it.
//
// The device token is independently revocable from the 1h interactive token, so
// a long offline shift flush does not 401 mid-stream while reads/realtime keep
// the short interactive TTL for fast offboarding revocation.
//
// REVOCATION CAVEAT (M1): there is no per-device kill switch yet. All device
// tokens are HS256-signed with the single shared DEVICE_TOKEN_SECRET, so the
// ONLY revocation lever today is rotating DEVICE_TOKEN_SECRET (which invalidates
// EVERY outstanding device token at once). A leaked token therefore stays valid
// for its ~24h TTL unless the secret is rotated. Mitigations already in place:
// (1) the ingest RPC re-verifies org/site against LIVE membership on every batch,
// so offboarding a guard (deactivating their membership) stops new inserts within
// the membership-lookup window even while the token still verifies; (2) the TTL
// is bounded at 24h. A future hardening (post-M1) is a per-install epoch/jti
// minted from a device_tokens counter so individual tokens can be revoked without
// rotating the shared secret — see the install_id note below.
//
// Env (injected at deploy): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   DEVICE_TOKEN_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const DEVICE_TOKEN_KIND = "device" as const;
// ~24h device token TTL (decoupled from the 1h interactive session).
const DEVICE_TOKEN_TTL_SECONDS = 24 * 60 * 60;

const JSON_HEADERS = { "content-type": "application/json" } as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

// Import the HMAC signing key once per worker.
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const deviceSecret = Deno.env.get("DEVICE_TOKEN_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !deviceSecret) {
    return jsonResponse({ error: "server_misconfigured" }, 500);
  }

  // ----- 1. extract the caller's interactive access token -------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return jsonResponse({ error: "missing_bearer_token" }, 401);
  }
  const accessToken = match[1];

  // ----- 1b. read the device-supplied install_id ---------------------------
  // The client generates a per-install UUID once and persists it; it posts that
  // here so the minter can bind it into the token. We validate the shape but do
  // NOT trust it for anything security-sensitive — it only scopes the device's
  // own clientSeq dedup namespace, so a malformed/forged value at worst affects
  // that one device's own idempotency, never another tenant.
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let installId: string;
  try {
    const reqBody = (await req.json()) as { install_id?: unknown };
    if (typeof reqBody?.install_id !== "string" || !UUID_RE.test(reqBody.install_id)) {
      return jsonResponse({ error: "missing_or_invalid_install_id" }, 400);
    }
    installId = reqBody.install_id;
  } catch (_e) {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // ----- 2. verify the session + resolve the user --------------------------
  // The service client validates the JWT against GoTrue and returns the user.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(accessToken);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "invalid_session" }, 401);
  }
  const userId = userData.user.id;

  // ----- 3. LIVE membership lookup (server authority, not the JWT copy) -----
  const { data: membership, error: memErr } = await admin
    .from("memberships")
    .select("org_id, role, site_ids, active")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (memErr) {
    return jsonResponse({ error: "membership_lookup_failed" }, 500);
  }
  if (!membership) {
    // No active membership → no device token. Fail closed.
    return jsonResponse({ error: "no_active_membership" }, 403);
  }

  // ----- 4. mint the device-scoped JWT -------------------------------------
  const key = await importHmacKey(deviceSecret);
  const nowSec = getNumericDate(0);
  const claims = {
    // @trailme/shared DeviceTokenClaimsSchema
    org_id: membership.org_id as string,
    guard_id: userId,
    site_ids: (membership.site_ids ?? []) as string[],
    // Bind the install epoch into the token so ingest attaches it authoritatively.
    install_id: installId,
    kind: DEVICE_TOKEN_KIND,
    // standard registered claims
    sub: userId,
    iat: nowSec,
    exp: getNumericDate(DEVICE_TOKEN_TTL_SECONDS),
    iss: "trailme-mint-device-token",
  };

  const token = await create({ alg: "HS256", typ: "JWT" }, claims, key);

  return jsonResponse(
    { token, expires_in: DEVICE_TOKEN_TTL_SECONDS, token_type: "Bearer" },
    200,
  );
});
