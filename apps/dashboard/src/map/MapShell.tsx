"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, Source, Layer, type MapRef } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { TIME_WINDOWS, type Role, type TimeWindow } from "@trailme/shared";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";

const DEFAULT_CENTER = { longitude: 10.7522, latitude: 59.9139, zoom: 13 };

// Property-scale zoom: a 0.5–5 ha site is ~70–220 m across, which sits well at
// zoom ~18 (building/parking-lot detail). Used for the single-person case.
const PROPERTY_ZOOM = 18;
// Never let "fit everyone" zoom out past this (keeps small sites readable) or in
// past PROPERTY_ZOOM (keeps a lone marker from filling the screen).
const FIT_MAX_ZOOM = 19;

// Distinct, always-on colour for the viewer's own marker/trail so "you" never
// blends into the org roster colours.
const YOU_COLOR = "#38bdf8";

// Drop coarse fixes (Wi-Fi/cell locate, often hundreds of metres off) so the
// first network fix doesn't shoot a line across the map and the dot lands on the
// real spot — only GPS-grade fixes (≤ this many metres of reported accuracy).
const ACCURACY_GATE_M = 50;
// Hold the live dot/trail in place unless a fix moves at least this far — above
// the GPS noise floor — so a stationary phone stops drifting. Raised toward the
// reported accuracy when GPS is poor, so noisier fixes need a bigger real move.
const MOVE_FLOOR_M = 8;

const MAP_STYLES = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  streets: "mapbox://styles/mapbox/streets-v12",
  dark: "mapbox://styles/mapbox/dark-v11",
} as const;
type StyleKey = keyof typeof MAP_STYLES;

type MapShellProps = {
  orgId: string | null;
  orgName: string | null;
  role: Role | null;
  email?: string;
};

type LivePoint = {
  guard_id: string;
  display_name: string | null;
  color: string | null;
  lat: number;
  lon: number;
  captured_at: string;
};

type Guard = { id: string; name: string; color: string; pts: LivePoint[] };
type TrailFix = { lng: number; lat: number; t: number };

export function MapShell({ orgId, orgName, role, email }: MapShellProps) {
  const [windowMinutes, setWindowMinutes] = useState<TimeWindow>(15);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [styleKey, setStyleKey] = useState<StyleKey>("satellite");
  const [myId, setMyId] = useState<string | null>(null);
  // The viewer's own GPS fixes, kept client-side so you see yourself + your
  // trail instantly — no dependency on the demo_live_map round-trip.
  const [myTrail, setMyTrail] = useState<TrailFix[]>([]);
  // Distinguish "asked for location, no fix yet" from "actively sharing" so the
  // button + footer don't lie during the fragile first-fix window.
  const [locating, setLocating] = useState(false);
  // Mobile browsers suspend watchPosition when the tab is hidden / screen locks;
  // surface that instead of leaving a frozen dot that looks live.
  const [hidden, setHidden] = useState(false);
  // Reported accuracy of the latest fix (metres) — shown so "a bit off" is a number.
  const [accuracyM, setAccuracyM] = useState<number | null>(null);

  const mapRef = useRef<MapRef | null>(null);
  const watchId = useRef<number | null>(null);
  const lastPush = useRef<number>(0);
  const centeredOnce = useRef(false);
  const firstFixRef = useRef(false);
  const awaitTimer = useRef<number | null>(null);

  const supabase = useMemo(() => createClient(), []);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Who am I? Lets us render our own marker locally and avoid drawing a
  // duplicate for ourselves from the org-wide feed.
  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setMyId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  // Poll the live map (positions + recent trail points) for the whole org.
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    async function load() {
      const { data, error } = await supabase.rpc("demo_live_map", { p_minutes: windowMinutes });
      if (!active) return;
      if (error) {
        setShareError(`Live map: ${error.message}`);
        return;
      }
      if (data) setPoints(data as LivePoint[]);
    }
    void load();
    // ~1.5s keeps peer dots/trails feeling live (the demo stand-in for the
    // unbuilt M3 Realtime broadcast); fine at demo scale.
    const id = setInterval(load, 1500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [orgId, windowMinutes, supabase]);

  // Stop watching geolocation (and cancel the first-fix watchdog) on unmount.
  useEffect(() => {
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      if (awaitTimer.current !== null) clearTimeout(awaitTimer.current);
    };
  }, []);

  // Track tab visibility so we can tell the user when sharing is paused.
  useEffect(() => {
    function onVis() {
      setHidden(document.visibilityState === "hidden");
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const stopSharing = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (awaitTimer.current !== null) {
      clearTimeout(awaitTimer.current);
      awaitTimer.current = null;
    }
    setSharing(false);
    setLocating(false);
  }, []);

  const toggleShare = useCallback(() => {
    if (sharing) {
      stopSharing();
      return;
    }
    if (!("geolocation" in navigator)) {
      setShareError("This browser has no geolocation.");
      return;
    }
    setShareError(null);
    setSharing(true);
    setLocating(true);
    firstFixRef.current = false;
    centeredOnce.current = false;

    // Watchdog: if no fix arrives, don't leave the button stuck on "Locating…".
    if (awaitTimer.current !== null) clearTimeout(awaitTimer.current);
    awaitTimer.current = window.setTimeout(() => {
      if (firstFixRef.current) return;
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setSharing(false);
      setLocating(false);
      setShareError("Couldn't get a GPS fix — move outdoors and tap Share again.");
    }, 15000);

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;

        // Ignore coarse (non-GPS) fixes entirely — they're what make the trail
        // jump across the map and the dot land a block away.
        if (accuracy != null && accuracy > ACCURACY_GATE_M) return;

        // First accurate fix: leave the "locating" state and cancel the watchdog.
        if (!firstFixRef.current) {
          firstFixRef.current = true;
          setLocating(false);
          if (awaitTimer.current !== null) {
            clearTimeout(awaitTimer.current);
            awaitTimer.current = null;
          }
        }

        if (!centeredOnce.current) {
          centeredOnce.current = true;
          mapRef.current?.flyTo({ center: [longitude, latitude], zoom: PROPERTY_ZOOM });
        }

        setAccuracyM(accuracy ?? null);

        // Append the fix, but only once it clears the GPS noise floor — so the
        // dot/trail track real movement yet hold steady when you're standing
        // still (jitter at this accuracy is a few metres per fix).
        setMyTrail((prev) => {
          const last = prev[prev.length - 1];
          if (!last) return [{ lng: longitude, lat: latitude, t: Date.now() }];
          const floor = Math.max(MOVE_FLOOR_M, accuracy ?? 0);
          if (metersBetween(last.lng, last.lat, longitude, latitude) < floor) return prev;
          return [...prev, { lng: longitude, lat: latitude, t: Date.now() }];
        });

        const now = Date.now();
        if (now - lastPush.current < 2500) return; // throttle pushes
        lastPush.current = now;
        void supabase.rpc("demo_push_position", { p_lat: latitude, p_lon: longitude }).then(
          ({ error }) => {
            if (error) setShareError(`Push: ${error.message}`);
          },
          (e: unknown) => setShareError(`Push failed: ${e instanceof Error ? e.message : String(e)}`),
        );
      },
      (err) => {
        if (awaitTimer.current !== null) {
          clearTimeout(awaitTimer.current);
          awaitTimer.current = null;
        }
        setShareError(geolocationErrorMessage(err));
        setSharing(false);
        setLocating(false);
        watchId.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
  }, [sharing, stopSharing, supabase]);

  const cutoff = Date.now() - windowMinutes * 60_000;

  // Other guards from the org feed (exclude myself — I'm rendered locally).
  // Client-trim to the same cutoff as my own trail so shrinking the time window
  // updates peers instantly, not only on the next poll.
  const guards = useMemo<Guard[]>(() => {
    const m = new Map<string, Guard>();
    for (const p of points) {
      if (p.guard_id === myId) continue;
      if (new Date(p.captured_at).getTime() < cutoff) continue;
      const g = m.get(p.guard_id) ?? {
        id: p.guard_id,
        name: p.display_name ?? "Guard",
        color: p.color ?? "#3b82f6",
        pts: [],
      };
      g.pts.push(p);
      m.set(p.guard_id, g);
    }
    return [...m.values()];
  }, [points, myId, cutoff]);

  // My own trail, trimmed to the selected window.
  const myWindowTrail = useMemo(() => myTrail.filter((f) => f.t >= cutoff), [myTrail, cutoff]);
  const myPos = myWindowTrail[myWindowTrail.length - 1] ?? null;

  const onMapCount = guards.length + (myPos ? 1 : 0);

  const trailGeoJSON = useMemo(() => {
    const features = guards
      .filter((g) => g.pts.length >= 2)
      .map((g) => ({
        type: "Feature" as const,
        properties: { color: g.color },
        geometry: { type: "LineString" as const, coordinates: g.pts.map((p) => [p.lon, p.lat]) },
      }));
    if (myWindowTrail.length >= 2) {
      features.push({
        type: "Feature" as const,
        properties: { color: YOU_COLOR },
        geometry: { type: "LineString" as const, coordinates: myWindowTrail.map((f) => [f.lng, f.lat]) },
      });
    }
    return { type: "FeatureCollection" as const, features };
  }, [guards, myWindowTrail]);

  // Frame everyone currently on the map (you + other guards' latest positions).
  const fitAll = useCallback(() => {
    const coords: [number, number][] = [];
    if (myPos) coords.push([myPos.lng, myPos.lat]);
    for (const g of guards) {
      const last = g.pts[g.pts.length - 1];
      if (last) coords.push([last.lon, last.lat]);
    }
    const first = coords[0];
    if (!first) return;
    if (coords.length === 1) {
      mapRef.current?.flyTo({ center: first, zoom: PROPERTY_ZOOM });
      return;
    }
    let minLng = first[0],
      maxLng = first[0],
      minLat = first[1],
      maxLat = first[1];
    for (const [lng, lat] of coords) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
    mapRef.current?.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 80, maxZoom: FIT_MAX_ZOOM, duration: 600 },
    );
  }, [guards, myPos]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      {mapboxToken ? (
        <MapGL
          ref={mapRef}
          mapboxAccessToken={mapboxToken}
          initialViewState={DEFAULT_CENTER}
          mapStyle={MAP_STYLES[styleKey]}
          style={{ width: "100%", height: "100%" }}
        >
          <Source id="trails" type="geojson" data={trailGeoJSON}>
            <Layer
              id="trail-lines"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85 }}
            />
          </Source>

          {guards.map((g) => {
            const last = g.pts[g.pts.length - 1];
            if (!last) return null;
            return (
              <Marker key={g.id} longitude={last.lon} latitude={last.lat} anchor="center">
                <GuardDot color={g.color} label={g.name} />
              </Marker>
            );
          })}

          {myPos && (
            <Marker longitude={myPos.lng} latitude={myPos.lat} anchor="center">
              <GuardDot color={YOU_COLOR} label="You" emphasized />
            </Marker>
          )}
        </MapGL>
      ) : (
        <div style={{ display: "grid", placeItems: "center", width: "100%", height: "100%", color: "var(--muted)" }}>
          Set <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to load the map.
        </div>
      )}

      <header
        style={{
          position: "absolute",
          top: "1rem",
          left: "1rem",
          right: "1rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
          padding: "0.625rem 0.875rem",
          background: "rgba(20, 25, 35, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong>{orgName ?? "TrailMe"} — Live</strong>
          <span style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
            {email ?? "—"}
            {role ? ` · ${role}` : ""}
            {` · ${onMapCount} on map`}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <TimeWindowSelector value={windowMinutes} onChange={setWindowMinutes} />
          <StyleSelector value={styleKey} onChange={setStyleKey} />
          <button type="button" onClick={fitAll} style={secondaryBtn}>
            Fit
          </button>
          <button
            type="button"
            onClick={toggleShare}
            style={{
              padding: "0.375rem 0.75rem",
              background: sharing ? "var(--danger)" : "var(--accent)",
              color: "var(--accent-foreground)",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {sharing ? (locating ? "◌ Locating…" : "■ Stop sharing") : "● Share my location"}
          </button>
          <a href="/admin/settings" style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
            Admin
          </a>
          <SignOutButton />
        </div>
      </header>

      {!orgId && (
        <div
          role="alert"
          style={{
            position: "absolute",
            top: "5rem",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 5,
            maxWidth: "32rem",
            padding: "0.75rem 1rem",
            background: "var(--danger)",
            color: "#fff",
            borderRadius: "var(--radius)",
            fontSize: "0.875rem",
            textAlign: "center",
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          Your account isn’t linked to an organization yet — you won’t see other guards. Ask an
          admin to add your membership.
        </div>
      )}

      <footer
        style={{
          position: "absolute",
          left: "1rem",
          bottom: "1rem",
          padding: "0.5rem 0.75rem",
          background: "rgba(20, 25, 35, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: shareError ? "var(--danger)" : "var(--muted)",
          fontSize: "0.8125rem",
          maxWidth: "28rem",
        }}
      >
        {shareError
          ? `Location error: ${shareError}`
          : sharing
            ? hidden
              ? "Sharing paused — phone asleep or tab hidden. Reopen this tab to resume."
              : locating
                ? "Allow location, then hold tight — getting your first GPS fix…"
                : myPos
                  ? `Sharing your location${accuracyM != null ? ` · GPS ±${Math.round(accuracyM)} m` : ""} — walk and watch your trail build.`
                  : "Sharing — waiting for your first GPS fix…"
            : onMapCount
              ? `${onMapCount} on the map over the last ${windowMinutes}m.`
              : "Tap “Share my location”, allow access, and walk — your trail appears here."}
      </footer>
    </div>
  );
}

// Great-circle distance in metres between two lon/lat points (haversine).
function metersBetween(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Turn a raw GeolocationPositionError into an actionable, retry-oriented message
// — the terse default ("User denied Geolocation") reads as "the app is broken".
function geolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission denied — enable location for this browser in Settings, then tap Share again.";
    case err.POSITION_UNAVAILABLE:
      return "Location unavailable — check that Location Services are on, then retry.";
    case err.TIMEOUT:
      return "Couldn’t get a GPS fix in time — move outdoors and tap Share again.";
    default:
      return err.message || "Location error.";
  }
}

const secondaryBtn: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  background: "var(--surface-2)",
  color: "var(--foreground)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontWeight: 600,
  cursor: "pointer",
};

function GuardDot({ color, label, emphasized }: { color: string; label: string; emphasized?: boolean }) {
  const size = emphasized ? 18 : 14;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          border: "2px solid #fff",
          boxShadow: emphasized
            ? `0 0 0 3px ${color}55, 0 0 0 1px rgba(0,0,0,0.5)`
            : "0 0 0 1px rgba(0,0,0,0.4)",
        }}
      />
      <span
        style={{
          fontSize: "0.75rem",
          color: "#fff",
          background: "rgba(0,0,0,0.6)",
          padding: "0 0.25rem",
          borderRadius: 4,
          whiteSpace: "nowrap",
          fontWeight: emphasized ? 700 : 400,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function StyleSelector({ value, onChange }: { value: StyleKey; onChange: (next: StyleKey) => void }) {
  const labels: Record<StyleKey, string> = { satellite: "Satellite", streets: "Streets", dark: "Dark" };
  return (
    <div role="group" aria-label="Map style" style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {(Object.keys(labels) as StyleKey[]).map((key) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            style={{
              padding: "0.25rem 0.5rem",
              background: active ? "var(--accent)" : "var(--surface-2)",
              color: active ? "var(--accent-foreground)" : "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontWeight: active ? 600 : 400,
            }}
          >
            {labels[key]}
          </button>
        );
      })}
    </div>
  );
}

function TimeWindowSelector({
  value,
  onChange,
}: {
  value: TimeWindow;
  onChange: (next: TimeWindow) => void;
}) {
  return (
    <div role="group" aria-label="Coverage time window (minutes)" style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
      {TIME_WINDOWS.map((minutes) => {
        const active = minutes === value;
        return (
          <button
            key={minutes}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(minutes)}
            style={{
              padding: "0.25rem 0.5rem",
              minWidth: "2.5rem",
              background: active ? "var(--accent)" : "var(--surface-2)",
              color: active ? "var(--accent-foreground)" : "var(--foreground)",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              fontWeight: active ? 600 : 400,
            }}
          >
            {minutes}m
          </button>
        );
      })}
    </div>
  );
}
