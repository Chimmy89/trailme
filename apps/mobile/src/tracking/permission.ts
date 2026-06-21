/**
 * OS location-permission request, behind the tracking seam.
 *
 * Called from the disclosure flow AFTER acceptance is recorded — the prominent
 * disclosure must precede the OS prompt (store + GDPR requirement). Returns true
 * when location access was granted (Always or When-In-Use).
 */
import BackgroundGeolocation from 'react-native-background-geolocation';

export async function requestLocationPermission(): Promise<boolean> {
  try {
    const status = await BackgroundGeolocation.requestPermission();
    // AUTHORIZATION_STATUS_ALWAYS (3) | WHEN_IN_USE (4) → granted.
    return status === 3 || status === 4;
  } catch {
    return false;
  }
}
