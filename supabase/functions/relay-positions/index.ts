// supabase/functions/relay-positions/index.ts
//
// TrailMe — consolidated live-position relay. STUB (M0): returns 501.
//
// Responsibility (implemented in M3):
//   Emits ONE consolidated 'positions' broadcast per site per tick instead of
//   quadratic peer-to-peer fan-out. It:
//     - reads the server-written guard_positions rows for a site (the
//       AUTHORITATIVE last-known source; client-published 'g' is never trusted);
//     - builds a single message of all active guards' SERVER-STAMPED
//       { guard_id, lat, lon, heading, captured_at, online } — so a guard can
//       never impersonate a peer or inject a ghost;
//     - publishes it to the private channel channelName(siteId) === "site:{id}"
//       via realtime.send. Subscribers apply the batch with one setData; live
//       ticks are ADVISORY and reconciled against guard_positions.
//   May instead be realized as a DB trigger calling realtime.send on the
//   guard_positions upsert — see ARCHITECTURE.md realtime section.
//
// Env (injected at deploy; canonical names): SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY.

import type { ConnInfo } from "https://deno.land/std@0.224.0/http/server.ts";

Deno.serve((_req: Request, _conn?: ConnInfo): Response => {
  return new Response(
    JSON.stringify({ error: "not_implemented", message: "relay-positions is not implemented in M0" }),
    { status: 501, headers: { "content-type": "application/json" } },
  );
});
