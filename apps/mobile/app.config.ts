import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * TrailMe field-guard app — Expo config.
 *
 * IMPORTANT: this app can NEVER run in Expo Go. It links two native modules
 * (background geolocation + Mapbox) and requires a custom dev client / EAS
 * build. `expo start` is launched with `--dev-client`.
 *
 * Native build secrets are read from the environment at build time (EAS reads
 * them from EAS Secrets / a local .env when prebuilding):
 *   - MAPBOX_DOWNLOADS_TOKEN  (sk.* token with DOWNLOADS:READ scope; pulls the
 *                              private @rnmapbox native artifact at build time)
 *   - RN_BG_GEO_LICENSE       (transistorsoft license key — see note below)
 *
 * Runtime config is read from EXPO_PUBLIC_* (inlined into the JS bundle).
 *
 * ── transistorsoft license (PAID, M2 dependency) ────────────────────────────
 * react-native-background-geolocation only ENFORCES its license in RELEASE
 * builds. Debug/dev-client builds run fine WITHOUT a valid key but log an
 * "invalid license" warning at startup. We don't have the paid license yet
 * (M2 deliverable), so `RN_BG_GEO_LICENSE` is allowed to be empty here — the
 * dev client still builds and tracks in debug. CI must assert a VALID license
 * in a release build before launch (see ARCHITECTURE.md M0/M2).
 */

const MAPBOX_DOWNLOADS_TOKEN = process.env.MAPBOX_DOWNLOADS_TOKEN ?? '';
const RN_BG_GEO_LICENSE = process.env.RN_BG_GEO_LICENSE ?? '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'TrailMe',
  slug: 'trailme',
  scheme: 'trailme',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  assetBundlePatterns: ['**/*'],

  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.trailme.guard',
    infoPlist: {
      // Prominent disclosure (in-app, pre-prompt) is shown BEFORE these OS
      // dialogs — these strings are the OS-level fallbacks (App Store reviewers
      // read them too). "Always" is required for screen-off patrol tracking.
      NSLocationWhenInUseUsageDescription:
        'TrailMe shows your live position to your team so guards don’t re-cover the same ground during a patrol.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'TrailMe records your patrol route in the background — even with the screen off — so your team has live coverage and lone-worker safety while you walk your site.',
      NSMotionUsageDescription:
        'TrailMe uses motion detection to track only while you are moving, which saves battery during a shift.',
      // location: live + background breadcrumbs; fetch: periodic keepalive flush.
      UIBackgroundModes: ['location', 'fetch'],
    },
  },

  android: {
    package: 'com.trailme.guard',
    permissions: [
      'ACCESS_COARSE_LOCATION',
      'ACCESS_FINE_LOCATION',
      // Screen-off / backgrounded patrol tracking. Requested at runtime AFTER
      // foreground location is granted (Android 10+ two-step flow).
      'ACCESS_BACKGROUND_LOCATION',
      // Persistent foreground service keeps tracking alive past Doze.
      'FOREGROUND_SERVICE',
      // Android 14 (API 34) requires the typed permission AND
      // foregroundServiceType=location (set by the RNBG config plugin below).
      'FOREGROUND_SERVICE_LOCATION',
      'WAKE_LOCK',
      // Prompt the user to exempt the app from battery optimization (OEM
      // battery-killer mitigation — see src/tracking + tracking-health screen).
      'REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
    ],
  },

  plugins: [
    'expo-router',
    [
      // ── Native maps ───────────────────────────────────────────────────────
      '@rnmapbox/maps',
      {
        // Build-time token to download the private native Mapbox SDK.
        RNMapboxMapsDownloadToken: MAPBOX_DOWNLOADS_TOKEN,
      },
    ],
    [
      // ── Background geolocation (transistorsoft) ───────────────────────────
      'react-native-background-geolocation',
      {
        // Empty in dev (no paid license yet — M2). Release builds enforce it.
        license: RN_BG_GEO_LICENSE,
      },
    ],
    [
      // Android 14+ requires foreground services to declare their type. The
      // RNBG plugin emits the FGS-location manifest entries; this guarantees
      // the location module is linked even before tracking is wired (M2).
      'expo-build-properties',
      {
        android: {
          // Headroom for the two heavy native modules; keeps Gradle happy.
          minSdkVersion: 24,
        },
      },
    ],
  ],

  extra: {
    // Runtime public config. Mirrors EXPO_PUBLIC_* so it is also reachable via
    // expo-constants if a consumer prefers Constants over process.env.
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
    mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '',
    eas: {
      // Populated by `eas init`. Left empty so the file is valid pre-link.
      projectId: '',
    },
  },
});
