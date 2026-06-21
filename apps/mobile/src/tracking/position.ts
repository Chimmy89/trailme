/**
 * One-shot current-position read, kept behind the tracking seam so screens
 * never import the native engine directly. Used by checkpoint tagging (the
 * server stamps guard_id; we only supply where the guard is standing).
 */
import BackgroundGeolocation from 'react-native-background-geolocation';

export interface CurrentPosition {
  lat: number;
  lon: number;
  accuracyM: number;
}

/**
 * Resolves the device's current position with a bounded wait. Throws if no fix
 * is available (deep basement, permission off) so the caller can tell the guard
 * rather than tag a stale/garbage point.
 */
export async function getCurrentPosition(): Promise<CurrentPosition> {
  const location = await BackgroundGeolocation.getCurrentPosition({
    samples: 1,
    timeout: 15,
    maximumAge: 5000,
    desiredAccuracy: 10,
  });
  return {
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    accuracyM: location.coords.accuracy,
  };
}
