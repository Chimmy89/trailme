"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MapGL, { Marker, Source, Layer, type MapRef } from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { TIME_WINDOWS, type Role, type TimeWindow } from "@trailme/shared";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";

const DEFAULT_CENTER = { longitude: 10.7522, latitude: 59.9139, zoom: 12 };

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

export function MapShell({ orgId, orgName, role, email }: MapShellProps) {
  const [windowMinutes, setWindowMinutes] = useState<TimeWindow>(15);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const mapRef = useRef<MapRef | null>(null);
  const watchId = useRef<number | null>(null);
  const lastPush = useRef<number>(0);
  const centeredOnce = useRef(false);

  const supabase = useMemo(() => createClient(), []);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Poll the live map (positions + recent trail points) for the whole org.
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    async function load() {
      const { data } = await supabase.rpc("demo_live_map", { p_minutes: windowMinutes });
      if (active && data) setPoints(data as LivePoint[]);
    }
    void load();
    const id = setInterval(load, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [orgId, windowMinutes, supabase]);

  // Stop watching geolocation on unmount.
  useEffect(() => {
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, []);

  const toggleShare = useCallback(() => {
    if (sharing) {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setSharing(false);
      return;
    }
    if (!("geolocation" in navigator)) {
      setShareError("This browser has no geolocation.");
      return;
    }
    setShareError(null);
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (!centeredOnce.current) {
          centeredOnce.current = true;
          mapRef.current?.flyTo({ center: [longitude, latitude], zoom: 15 });
        }
        const now = Date.now();
        if (now - lastPush.current < 2500) return; // throttle pushes
        lastPush.current = now;
        void supabase
          .rpc("demo_push_position", { p_lat: latitude, p_lon: longitude })
          .then(({ error }) => error && setShareError(error.message));
      },
      (err) => {
        setShareError(err.message || "Location permission denied.");
        setSharing(false);
        watchId.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 12000 },
    );
  }, [sharing, supabase]);

  const guards = useMemo<Guard[]>(() => {
    const m = new Map<string, Guard>();
    for (const p of points) {
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
  }, [points]);

  const trailGeoJSON = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: guards
        .filter((g) => g.pts.length >= 2)
        .map((g) => ({
          type: "Feature" as const,
          properties: { color: g.color },
          geometry: { type: "LineString" as const, coordinates: g.pts.map((p) => [p.lon, p.lat]) },
        })),
    }),
    [guards],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100dvh" }}>
      {mapboxToken ? (
        <MapGL
          ref={mapRef}
          mapboxAccessToken={mapboxToken}
          initialViewState={DEFAULT_CENTER}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          style={{ width: "100%", height: "100%" }}
        >
          <Source id="trails" type="geojson" data={trailGeoJSON}>
            <Layer
              id="trail-lines"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.7 }}
            />
          </Source>

          {guards.map((g) => {
            const last = g.pts[g.pts.length - 1];
            if (!last) return null;
            return (
              <Marker key={g.id} longitude={last.lon} latitude={last.lat} anchor="center">
                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: g.color,
                      border: "2px solid #fff",
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.4)",
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
                    }}
                  >
                    {g.name}
                  </span>
                </div>
              </Marker>
            );
          })}
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
            {` · ${guards.length} on map`}
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
            {sharing ? "■ Stop sharing" : "● Share my location"}
          </button>
          <a href="/admin/settings" style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
            Admin
          </a>
          <SignOutButton />
        </div>
      </header>

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
            ? "Sharing your location — walk around and watch your trail build."
            : guards.length
              ? `${guards.length} guard(s) on the map over the last ${windowMinutes}m.`
              : "Tap “Share my location”, allow access, and walk — your trail appears here."}
      </footer>
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
