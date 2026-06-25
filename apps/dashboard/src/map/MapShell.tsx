"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, Source, Layer, type MapRef } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { TIME_WINDOWS, type Role, type TimeWindow } from "@trailme/shared";
import { coverageHeatmapLayer, SOURCE_IDS } from "@trailme/map-style";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import { GpsKalman } from "./gpsKalman";
import { pushTrailPoint, trailToLine, type TrailPoint } from "./trail";
import { buildCoverageGeoJSON } from "./coverage";
import { circlePolygon, metersBetween } from "./geo";

const DEFAULT_CENTER = { longitude: 10.7522, latitude: 59.9139, zoom: 13 };

// Property-scale zoom: a 0.5–5 ha site is ~70–220 m across, which sits well at
// zoom ~18 (building/parking-lot detail). Used for the single-person case.
const PROPERTY_ZOOM = 18;
const FIT_MAX_ZOOM = 19;

// Distinct, always-on colour for the viewer's own marker/trail/halo.
const YOU_COLOR = "#38bdf8";

// Coverage heatmap paint, built once (pure, no deps) so the paint object is a
// stable reference — calling the factory per render would re-diff the layer.
const HEATMAP_SPEC = coverageHeatmapLayer();
// react-map-gl's LayerProps is a union discriminated by `type`; narrow it to the
// heatmap member so the portable PaintSpec lands on the right paint shape.
type HeatmapPaint = Extract<React.ComponentProps<typeof Layer>, { type: "heatmap" }>["paint"];
// >0 snaps coverage to an N-metre grid (keep freshest per cell) = "area covered".
// 0 = honest dwell density (default). Try 8 (≈ GPS floor) if parked guards over-hot.
const COVERAGE_BIN_METERS = 0;

// rAF easing toward the filtered target (smaller = smoother + laggier render).
const RENDER_EASE = 0.15;
// Don't re-render the marker for sub-decimetre animation steps (caps renders
// when the dot is parked — no work while you stand still).
const RENDER_COMMIT_M = 0.15;

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
type LL = { lng: number; lat: number };

export function MapShell({ orgId, orgName, role, email }: MapShellProps) {
  const [windowMinutes, setWindowMinutes] = useState<TimeWindow>(15);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [styleKey, setStyleKey] = useState<StyleKey>("satellite");
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [hidden, setHidden] = useState(false);
  // Filtered 1-σ accuracy (metres) — drives the halo radius + the status readout.
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  // The RENDERED (rAF-interpolated) self position — what the dot + halo show.
  const [displayPos, setDisplayPos] = useState<LL | null>(null);
  // The viewer's own recorded trail (filtered points; decimated + simplified on render).
  const [myTrail, setMyTrail] = useState<TrailPoint[]>([]);
  // Coarse clock so the time-window cutoff (and its memos) don't recompute every
  // animation frame — only every couple of seconds.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const mapRef = useRef<MapRef | null>(null);
  const watchId = useRef<number | null>(null);
  const lastPush = useRef<number>(0);
  const centeredOnce = useRef(false);
  const firstFixRef = useRef(false);
  const awaitTimer = useRef<number | null>(null);
  const selfKf = useRef<GpsKalman | null>(null);
  const targetRef = useRef<LL | null>(null); // latest filtered position
  const renderedRef = useRef<LL | null>(null); // interpolated position

  const supabase = useMemo(() => createClient(), []);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Who am I? Lets us render our own marker locally and avoid drawing a duplicate
  // for ourselves from the org-wide feed.
  useEffect(() => {
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setMyId(data.user?.id ?? null);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  // Coarse clock tick (keeps the window cutoff stable between frames).
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  // Poll the live map (org-wide positions + recent trail points).
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
    const id = setInterval(load, 1500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [orgId, windowMinutes, supabase]);

  // Watch teardown on unmount.
  useEffect(() => {
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      if (awaitTimer.current !== null) clearTimeout(awaitTimer.current);
    };
  }, []);

  // requestAnimationFrame loop: ease the rendered dot toward the filtered target
  // so it glides smoothly between the (≤1 Hz) fixes instead of teleporting.
  useEffect(() => {
    if (!sharing) return;
    let raf = 0;
    const step = () => {
      const tgt = targetRef.current;
      const rnd = renderedRef.current;
      if (tgt && rnd) {
        const next = {
          lng: rnd.lng + (tgt.lng - rnd.lng) * RENDER_EASE,
          lat: rnd.lat + (tgt.lat - rnd.lat) * RENDER_EASE,
        };
        renderedRef.current = next;
        setDisplayPos((prev) =>
          prev && metersBetween(prev.lng, prev.lat, next.lng, next.lat) < RENDER_COMMIT_M
            ? prev
            : next,
        );
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [sharing]);

  // ---- geolocation watch (filter every fix; never gate/drop) ----
  const startWatch = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setShareError("This browser has no geolocation.");
      return;
    }
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const t = pos.timestamp || Date.now();

        if (!firstFixRef.current) {
          firstFixRef.current = true;
          setLocating(false);
          if (awaitTimer.current !== null) {
            clearTimeout(awaitTimer.current);
            awaitTimer.current = null;
          }
        }
        setShareError(null);

        if (!selfKf.current) selfKf.current = new GpsKalman();
        const f = selfKf.current.update({ lat: latitude, lng: longitude, accuracy, timestamp: t });
        setAccuracyM(f.accuracy);

        const target: LL = { lng: f.lng, lat: f.lat };
        targetRef.current = target;
        if (renderedRef.current == null) {
          renderedRef.current = target; // snap on first fix / after a re-seed
          setDisplayPos(target);
        }
        if (!centeredOnce.current) {
          centeredOnce.current = true;
          mapRef.current?.flyTo({ center: [f.lng, f.lat], zoom: PROPERTY_ZOOM });
        }

        setMyTrail((prev) => pushTrailPoint(prev, { lng: f.lng, lat: f.lat, t, acc: f.accuracy }));

        // Push the FILTERED position + its honest 1-σ accuracy so the DB and
        // every peer's trail are clean at the source. ~1 Hz while moving, ~every
        // 4 s as a keepalive while still.
        const interval = selfKf.current.speed > 0.5 ? 1000 : 4000;
        const now = Date.now();
        if (now - lastPush.current < interval) return;
        lastPush.current = now;
        void supabase
          .rpc("demo_push_position", { p_lat: f.lat, p_lon: f.lng, p_accuracy: f.accuracy })
          .then(
          ({ error }) => {
            if (error) setShareError(`Push: ${error.message}`);
          },
          (e: unknown) => setShareError(`Push failed: ${e instanceof Error ? e.message : String(e)}`),
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          if (awaitTimer.current !== null) {
            clearTimeout(awaitTimer.current);
            awaitTimer.current = null;
          }
          if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          setShareError(geolocationErrorMessage(err));
          setSharing(false);
          setLocating(false);
        } else {
          // TIMEOUT / POSITION_UNAVAILABLE are transient — keep the watch alive
          // (clearing it is what looks like a freeze) and just surface it.
          setShareError(geolocationErrorMessage(err));
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }, [supabase]);

  const stopSharing = useCallback(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    if (awaitTimer.current !== null) {
      clearTimeout(awaitTimer.current);
      awaitTimer.current = null;
    }
    setSharing(false);
    setLocating(false);
    selfKf.current = null;
    targetRef.current = null;
    renderedRef.current = null;
    setDisplayPos(null);
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
    selfKf.current = new GpsKalman();
    targetRef.current = null;
    renderedRef.current = null;
    setDisplayPos(null);
    setMyTrail([]);
    lastPush.current = 0;

    if (awaitTimer.current !== null) clearTimeout(awaitTimer.current);
    awaitTimer.current = window.setTimeout(() => {
      if (firstFixRef.current) return;
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setSharing(false);
      setLocating(false);
      setShareError("Couldn't get a GPS fix — move outdoors and tap Share again.");
    }, 15000);

    startWatch();
  }, [sharing, stopSharing, startWatch]);

  // Mobile browsers suspend watchPosition when hidden/locked. On regain, re-seed
  // the filter (so we don't lerp across the gap) and restart the watch.
  useEffect(() => {
    function onVis() {
      const isHidden = document.visibilityState === "hidden";
      setHidden(isHidden);
      if (!isHidden && sharing) {
        selfKf.current?.reset();
        renderedRef.current = null;
        startWatch();
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [sharing, startWatch]);

  const cutoff = nowTick - windowMinutes * 60_000;

  // Other guards from the org feed (exclude myself — rendered locally).
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

  const myWindowTrail = useMemo(() => myTrail.filter((f) => f.t >= cutoff), [myTrail, cutoff]);

  // Coverage heatmap source: org-wide breadcrumbs (incl. self), each weighted by
  // recency. Same poll/clock cadence as the trail memos — never per animation frame.
  const coverageGeoJSON = useMemo(
    () =>
      buildCoverageGeoJSON(
        points,
        nowTick,
        windowMinutes * 60_000,
        COVERAGE_BIN_METERS > 0 ? { binMeters: COVERAGE_BIN_METERS } : undefined,
      ),
    [points, nowTick, windowMinutes],
  );

  const myPos = displayPos;
  const onMapCount = guards.length + (myPos ? 1 : 0);

  const selfHalo = useMemo(
    () =>
      sharing && displayPos && accuracyM != null
        ? circlePolygon(displayPos.lng, displayPos.lat, accuracyM)
        : null,
    [sharing, displayPos, accuracyM],
  );

  const trailGeoJSON = useMemo(() => {
    const features = guards
      .filter((g) => g.pts.length >= 2)
      .map((g) => lineFeature(g.color, g.pts.map((p) => [p.lon, p.lat])));
    const selfLine = trailToLine(myWindowTrail);
    if (selfLine.length >= 2) features.push(lineFeature(YOU_COLOR, selfLine));
    return { type: "FeatureCollection" as const, features };
  }, [guards, myWindowTrail]);

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
    let minLng = first[0];
    let maxLng = first[0];
    let minLat = first[1];
    let maxLat = first[1];
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

          {/* Coverage heatmap (M4). beforeId pins it BELOW the trail line — react-map-gl
              z-order follows addLayer order, NOT JSX order, and the toggle mounts this
              after load, so without an anchor it would paint OVER the trails. Rendered
              after the trails <Source> so "trail-lines" always exists first. */}
          {showHeatmap && coverageGeoJSON.features.length > 0 && (
            <Source id={SOURCE_IDS.COVERAGE} type="geojson" data={coverageGeoJSON}>
              <Layer
                id={HEATMAP_SPEC.id}
                type="heatmap"
                beforeId="trail-lines"
                paint={HEATMAP_SPEC.paint as unknown as HeatmapPaint}
              />
            </Source>
          )}

          {selfHalo && (
            <Source id="self-accuracy" type="geojson" data={selfHalo}>
              <Layer
                id="self-accuracy-fill"
                type="fill"
                paint={{ "fill-color": YOU_COLOR, "fill-opacity": 0.12 }}
              />
              <Layer
                id="self-accuracy-line"
                type="line"
                paint={{ "line-color": YOU_COLOR, "line-opacity": 0.35, "line-width": 1 }}
              />
            </Source>
          )}

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
          <button
            type="button"
            aria-pressed={showHeatmap}
            onClick={() => setShowHeatmap((v) => !v)}
            style={{
              ...secondaryBtn,
              background: showHeatmap ? "var(--accent)" : "var(--surface-2)",
              color: showHeatmap ? "var(--accent-foreground)" : "var(--foreground)",
            }}
          >
            Heatmap
          </button>
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

function lineFeature(color: string, coordinates: [number, number][]) {
  return {
    type: "Feature" as const,
    properties: { color },
    geometry: { type: "LineString" as const, coordinates },
  };
}

// Turn a raw GeolocationPositionError into an actionable, retry-oriented message.
function geolocationErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission denied — enable location for this browser in Settings, then tap Share again.";
    case err.POSITION_UNAVAILABLE:
      return "Location unavailable — check that Location Services are on, then retry.";
    case err.TIMEOUT:
      return "Still searching for GPS — move outdoors for a clearer sky view.";
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
