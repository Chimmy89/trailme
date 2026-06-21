// React Native must polyfill the WHATWG URL API before supabase-js loads,
// otherwise the realtime/websocket URL parsing throws on device.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@trailme/db-types';
import type { TrailmeClient } from '@trailme/supabase-client';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loudly at startup rather than producing confusing 401s later.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in apps/mobile/.env (see README) before starting the dev client.',
  );
}

/**
 * The interactive auth session for the field app.
 *
 * - AsyncStorage persists the session across app launches.
 * - autoRefreshToken keeps the 1h access token fresh while the app is in the
 *   foreground. NOTE: durable breadcrumb ingest does NOT use this short-lived
 *   session — that path uses a separate ~24h device-scoped ingest token minted
 *   server-side (see ARCHITECTURE.md). This client is for reads + realtime +
 *   the interactive login only.
 * - detectSessionInUrl is false: RN has no URL bar; deep-link auth is handled
 *   explicitly if/when magic links are added.
 *
 * We construct the client here rather than via @trailme/supabase-client's
 * createAnonClient because React Native needs an AsyncStorage auth-storage
 * adapter (so the session survives app restarts) and the url-polyfill side
 * effect above — neither of which the shared web/server factory wires. We still
 * type it as TrailmeClient (= SupabaseClient<Database>) so the app shares the
 * platform's end-to-end schema typing.
 */
export const supabase: TrailmeClient = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
