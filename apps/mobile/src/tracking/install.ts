/**
 * Per-install identity.
 *
 * `install_id` is a UUID generated ONCE per app install and persisted for the
 * life of the install. It scopes the per-install `clientSeq` dedup namespace:
 * the ingest idempotency key is `(guardId, installId, clientSeq)`, so a
 * reinstall (which resets `clientSeq` to 0) gets a FRESH `installId` and its
 * genuinely-new fixes are no longer mistaken for replays of the prior install's
 * already-ingested rows. See @trailme/shared BreadcrumbSchema / device-token.
 *
 * It is NOT a secret — it only namespaces this one device's own idempotency, so
 * a non-cryptographic v4 generator is sufficient when `crypto.randomUUID` is
 * unavailable on the RN/Hermes runtime.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const INSTALL_ID_KEY = 'trailme.installId';

/** RFC-4122 v4 UUID. Prefers the platform CSPRNG; falls back to Math.random. */
function uuidv4(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  // Fallback: a v4 UUID is fine from a non-crypto source for a dedup-scope id.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cached: string | null = null;

/**
 * Returns this install's stable `install_id`, generating + persisting it on
 * first call. Cached in-memory so the hot path doesn't hit AsyncStorage twice.
 */
export async function getInstallId(): Promise<string> {
  if (cached) return cached;

  const existing = await AsyncStorage.getItem(INSTALL_ID_KEY);
  if (existing) {
    cached = existing;
    return existing;
  }

  const fresh = uuidv4();
  await AsyncStorage.setItem(INSTALL_ID_KEY, fresh);
  cached = fresh;
  return fresh;
}
