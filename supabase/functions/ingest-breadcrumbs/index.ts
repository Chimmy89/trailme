// supabase/functions/ingest-breadcrumbs/index.ts
//
// TrailMe M1 — breadcrumb ingest endpoint.
//
// The native HTTP autoSync POSTs batches of buffered fixes here. This function:
//   - authenticates with the long-lived DEVICE-INGEST token (NOT the 1h
//     interactive session — a long offline flush must not 401), verifying the
//     HS256 signature against DEVICE_TOKEN_SECRET and the claim shape
//     { org_id, guard_id, site_ids, kind:'device' } (see @trailme/shared);
//   - validates the batch body against the BreadcrumbBatch wire shape;
//   - PRESERVES the TRUE device captured_at (never rewritten — Art. 5(1)(d));
//     derives a partition bucket separately and CLAMPS only if insane, flagging
//     the row is_low_confidence so the heatmap excludes it;
//   - accuracy-filters: a fix worse than ~50m is flagged is_low_confidence
//     (kept for accountability, excluded from heatmap reads), not silently lost;
//   - discards a stuck/duplicate last-known (same lat/lon/seq as the immediately
//     preceding fix) by flagging it low-confidence;
//   - calls the SECURITY DEFINER batch_insert_breadcrumbs RPC via the service
//     client (re-verifies org/site vs membership, dedups, upserts position);
//   - returns the PER-BATCH report { accepted, rejected[] } matching
//     @trailme/shared BreadcrumbIngestResult so the client never silently loses
//     points; rows the function itself cannot parse go to dead_letter.
//
// Env (injected at deploy): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   DEVICE_TOKEN_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { decode, verify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const DEVICE_TOKEN_KIND = "device";
// The minter (mint-device-token) signs HS256 and stamps this issuer. We pin both
// so a token signed with a different alg/issuer (e.g. an attacker downgrading to
// 'none', or a token minted by a different service) is rejected.
const DEVICE_TOKEN_ALG = "HS256";
const DEVICE_TOKEN_ISS = "trailme-mint-device-token";
// Horizontal-accuracy threshold (metres). Worse than this → low-confidence.
const ACCURACY_THRESHOLD_M = 50;
// Insane-time bounds mirror the SQL clamp (trailme_partition_ts): >1d future,
// >90d past. A row outside these has its partition bucket clamped + is flagged.
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;
const PAST_SLACK_MS = 90 * 24 * 60 * 60 * 1000;

const JSON_HEADERS = { "content-type": "application/json" } as const;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// One device-token claim set, post-verification.
interface DeviceClaims {
  org_id: string;
  guard_id: string;
  site_ids: string[];
  install_id: string;
  kind: string;
}

// One incoming wire breadcrumb (mirrors @trailme/shared BreadcrumbSchema).
// NOTE: the wire shape carries installId (the client's persisted epoch), but the
// ingest function attaches the TOKEN's install_id authoritatively to each row —
// the per-row installId is not trusted, exactly like guardId/orgId.
interface WireBreadcrumb {
  guardId: string;
  installId: string;
  lat: number;
  lon: number;
  capturedAt: string;
  clientSeq: number;
  accuracyM: number;
  isKeepalive: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lightweight validation of a single wire breadcrumb. Returns null if invalid
// (the caller dead-letters / reports 'unparseable' rather than throwing).
function parseBreadcrumb(x: unknown): WireBreadcrumb | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.guardId !== "string" || !UUID_RE.test(o.guardId)) return null;
  if (typeof o.installId !== "string" || !UUID_RE.test(o.installId)) return null;
  if (typeof o.lat !== "number" || o.lat < -90 || o.lat > 90) return null;
  if (typeof o.lon !== "number" || o.lon < -180 || o.lon > 180) return null;
  if (typeof o.capturedAt !== "string") return null;
  if (Number.isNaN(Date.parse(o.capturedAt))) return null;
  if (typeof o.clientSeq !== "number" || !Number.isInteger(o.clientSeq) || o.clientSeq < 0) return null;
  if (typeof o.accuracyM !== "number" || o.accuracyM < 0) return null;
  if (typeof o.isKeepalive !== "boolean") return null;
  return {
    guardId: o.guardId,
    installId: o.installId,
    lat: o.lat,
    lon: o.lon,
    capturedAt: o.capturedAt,
    clientSeq: o.clientSeq,
    accuracyM: o.accuracyM,
    isKeepalive: o.isKeepalive,
  };
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

  // ----- 1. verify the DEVICE token ----------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return jsonResponse({ error: "missing_bearer_token" }, 401);

  let claims: DeviceClaims;
  try {
    const token = m[1];

    // PIN THE ALGORITHM: decode the header WITHOUT trusting it, and reject any
    // alg other than HS256 BEFORE verifying. djwt infers HS256 from the HMAC key,
    // but we must not let a token whose header claims a different alg (e.g.
    // 'none', or an asymmetric alg) reach verify() — assert it explicitly.
    const [header] = decode(token) as [{ alg?: string }, unknown, unknown];
    if (!header || header.alg !== DEVICE_TOKEN_ALG) {
      return jsonResponse({ error: "invalid_device_token_alg" }, 401);
    }

    const key = await importHmacKey(deviceSecret);
    const payload = await verify(token, key); // throws on bad signature / expiry

    // Bind the token to THIS minter and require a real expiry. djwt enforces exp
    // when present; a token minted without exp would otherwise verify forever, so
    // we assert exp is a number. iss pins the issuer so a token signed with the
    // same shared secret by some other service cannot be replayed here.
    if (payload.iss !== DEVICE_TOKEN_ISS || typeof payload.exp !== "number") {
      return jsonResponse({ error: "invalid_device_token_claims" }, 401);
    }
    if (
      typeof payload.org_id !== "string" ||
      typeof payload.guard_id !== "string" ||
      typeof payload.install_id !== "string" ||
      payload.kind !== DEVICE_TOKEN_KIND ||
      !Array.isArray(payload.site_ids)
    ) {
      return jsonResponse({ error: "invalid_device_token_claims" }, 401);
    }
    claims = {
      org_id: payload.org_id,
      guard_id: payload.guard_id,
      site_ids: payload.site_ids as string[],
      install_id: payload.install_id,
      kind: payload.kind,
    };
  } catch (_e) {
    // Signed-but-expired or forged → 401. (A device token for org A still gets
    // its rows rejected server-side by the RPC re-verify even if it verifies.)
    return jsonResponse({ error: "invalid_device_token" }, 401);
  }

  // ----- 2. parse the batch body -------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch (_e) {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const arr = (body as { breadcrumbs?: unknown })?.breadcrumbs;
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 500) {
    return jsonResponse({ error: "invalid_batch" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Default routing site for this device. The native sync carries a single
  // guard per token; the RPC re-verifies the (guard, org, site) triple anyway.
  // We pick the first claimed site as the row's site_id. A guard with multiple
  // sites still has every row re-checked against membership server-side.
  const routingSite = claims.site_ids[0];

  // ----- 3. transform: preserve captured_at, derive flags ------------------
  const now = Date.now();
  const rpcRows: Array<Record<string, unknown>> = [];
  const rejected: Array<{ clientSeq: number; reason: string }> = [];
  const deadLetters: Array<Record<string, unknown>> = [];

  // For stuck-last-known detection within this batch (per guard).
  const lastByGuard = new Map<string, { lat: number; lon: number }>();

  for (const raw of arr) {
    const bc = parseBreadcrumb(raw);
    if (!bc) {
      rejected.push({ clientSeq: typeof (raw as { clientSeq?: number })?.clientSeq === "number" ? (raw as { clientSeq: number }).clientSeq : -1, reason: "unparseable" });
      deadLetters.push({ org_id: claims.org_id, guard_id: claims.guard_id, client_seq: null, reason: "unparseable", raw });
      continue;
    }

    // The token's guard_id is authoritative; a row claiming a different guard is
    // a forgery attempt — reject (never trust the body's guardId over the token).
    // Report the distinct security reason, NOT 'off_shift_gate'.
    if (bc.guardId !== claims.guard_id) {
      rejected.push({ clientSeq: bc.clientSeq, reason: "forged_or_inactive" });
      deadLetters.push({ org_id: claims.org_id, guard_id: bc.guardId, client_seq: bc.clientSeq, reason: "guard_id_mismatch", raw });
      continue;
    }

    // Reject if the device has no routable site claim at all. This is a
    // misconfigured/forged token (a valid device always carries >=1 site), so
    // surface it as 'forged_or_inactive' rather than a benign gate miss.
    if (!routingSite) {
      rejected.push({ clientSeq: bc.clientSeq, reason: "forged_or_inactive" });
      deadLetters.push({ org_id: claims.org_id, guard_id: claims.guard_id, client_seq: bc.clientSeq, reason: "no_site_claim", raw });
      continue;
    }

    const tMs = Date.parse(bc.capturedAt);

    // ----- accuracy filter: flag low-confidence (kept, heatmap-excluded) ----
    let isLowConfidence = false;
    if (bc.accuracyM > ACCURACY_THRESHOLD_M) {
      isLowConfidence = true;
    }

    // ----- insane-time flag (the SQL clamp routes the partition; we flag) ----
    if (tMs > now + FUTURE_SLACK_MS || tMs < now - PAST_SLACK_MS) {
      // Beyond the clamp window: the RPC will reject as captured_at_insane.
      // We still send it so the rejection + dead-letter happens server-side
      // (single source of truth), but flag it low-confidence defensively.
      isLowConfidence = true;
    }

    // ----- stuck / duplicate last-known: flag low-confidence ----------------
    // A keepalive at the exact same point as the previous fix is a parked guard;
    // it must not create a false hotspot. We keep it (accountability) but flag.
    const prev = lastByGuard.get(bc.guardId);
    if (prev && prev.lat === bc.lat && prev.lon === bc.lon) {
      isLowConfidence = true;
    }
    lastByGuard.set(bc.guardId, { lat: bc.lat, lon: bc.lon });

    // A keepalive is by definition heatmap-excluded; carry the flag through.
    rpcRows.push({
      guard_id: claims.guard_id, // authoritative from the token
      install_id: claims.install_id, // authoritative from the token (idempotency epoch)
      org_id: claims.org_id, // authoritative from the token (RPC re-verifies)
      site_id: routingSite,
      lat: bc.lat,
      lon: bc.lon,
      captured_at: bc.capturedAt, // TRUE event time — never rewritten
      client_seq: bc.clientSeq,
      accuracy_m: bc.accuracyM,
      is_keepalive: bc.isKeepalive,
      is_low_confidence: isLowConfidence,
    });
  }

  // ----- 4. dead-letter the rows we hard-rejected BEFORE the RPC -----------
  if (deadLetters.length > 0) {
    // Best-effort: a dead-letter insert failure must not lose the whole batch.
    await admin.from("dead_letter_breadcrumbs").insert(deadLetters);
  }

  // ----- 5. call the idempotent ingest RPC ---------------------------------
  let accepted = 0;
  if (rpcRows.length > 0) {
    const { data, error } = await admin.rpc("batch_insert_breadcrumbs", {
      p_rows: rpcRows,
    });
    if (error) {
      // The RPC itself failed (not a per-row rejection). Do NOT 200: the client
      // must retry the whole batch — nothing was confirmed persisted.
      return jsonResponse({ error: "ingest_failed", detail: error.message }, 502);
    }
    const report = data as { accepted: number; rejected: Array<{ clientSeq: number; reason: string }> };
    accepted = report.accepted ?? 0;
    for (const r of report.rejected ?? []) {
      rejected.push({ clientSeq: r.clientSeq, reason: r.reason });
    }
  }

  // ----- 6. per-batch report (BreadcrumbIngestResult) ----------------------
  return jsonResponse({ accepted, rejected }, 200);
});
