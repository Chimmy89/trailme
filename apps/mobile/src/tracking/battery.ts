/**
 * OEM battery-killer mitigation, behind the tracking seam.
 *
 * Aggressive OEMs (Samsung, Xiaomi, Huawei, Oppo/Vivo) freeze even a
 * foreground-service app unless the user exempts it from battery optimization.
 * The engine exposes deviceSettings helpers to detect the state and deep-link to
 * the right per-OEM screen (there is no silent API for this). Android-only;
 * on iOS these resolve to no-ops / not-applicable.
 */
import { Platform } from 'react-native';
import BackgroundGeolocation from 'react-native-background-geolocation';

/** True if TrailMe is already exempt from battery optimization (Android). */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    return await BackgroundGeolocation.deviceSettings.isIgnoringBatteryOptimizations();
  } catch {
    return false;
  }
}

/**
 * Opens the OEM battery-exemption settings screen for this device. Returns false
 * if the screen could not be shown (non-Android, or the OEM exposes no intent).
 */
export async function openBatteryExemptionSettings(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const request = await BackgroundGeolocation.deviceSettings.showIgnoreBatteryOptimizations();
    return await BackgroundGeolocation.deviceSettings.show(request);
  } catch {
    return false;
  }
}
