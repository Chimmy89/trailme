/**
 * Device-token + ingest-endpoint wiring for the durable breadcrumb path.
 *
 * The native HTTP sync (transistorsoft) flushes the SQLite buffer to the
 * `ingest-breadcrumbs` Edge Function authed by a ~24h DEVICE token — decoupled
 * from the 1h interactive session so a long offline flush doesn't 401 mid-stream
 * (see ARCHITECTURE.md "Device ingest credential"). This module:
 *   - builds the Edge Function URLs from EXPO_PUBLIC_SUPABASE_URL,
 *   - mints the device token via `mint-device-token` using the interactive
 *     session's access token + this install's persisted install_id.
 */
import type { Session } from '@supabase/supabase-js';

import { getInstallId } from './install';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Functions base, e.g. https://<ref>.supabase.co/functions/v1. */
function functionsBase(): string {
  if (!SUPABASE_URL) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL for ingest endpoints.');
  }
  return `${SUPABASE_URL.replace(/\/+$/, '')}/functions/v1`;
}

/** The URL transistorsoft's native HTTP sync POSTs breadcrumb batches to. */
export function ingestBreadcrumbsUrl(): string {
  return `${functionsBase()}/ingest-breadcrumbs`;
}

export interface DeviceTokenResult {
  token: string;
  /** Seconds until the device token expires (~24h). */
  expiresIn: number;
  /** This install's persisted install_id (bound into the token by the minter). */
  installId: string;
}

/**
 * Mints a ~24h device-scoped ingest JWT for this install.
 *
 * Posts the interactive session's access token (Authorization) + the persisted
 * install_id to `mint-device-token`; the minter verifies the session, reads the
 * LIVE membership, and binds install_id into the token so ingest attaches it
 * authoritatively to every fix.
 */
export async function mintDeviceToken(session: Session): Promise<DeviceTokenResult> {
  if (!SUPABASE_ANON_KEY) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_ANON_KEY for token mint.');
  }
  const installId = await getInstallId();

  const res = await fetch(`${functionsBase()}/mint-device-token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The function gates on the interactive session; the anon key satisfies
      // the gateway's apikey requirement for invoking the function.
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ install_id: installId }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`mint-device-token failed (${res.status}): ${detail}`);
  }

  const body = (await res.json()) as { token?: string; expires_in?: number };
  if (!body.token) {
    throw new Error('mint-device-token returned no token.');
  }
  return {
    token: body.token,
    expiresIn: body.expires_in ?? 24 * 60 * 60,
    installId,
  };
}
