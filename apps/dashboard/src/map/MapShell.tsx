"use client";

import { useState } from "react";
import Map from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { TIME_WINDOWS, type Role, type TimeWindow } from "@trailme/shared";
// Layer style objects live in the shared map-style package so web and mobile
// render identical colors/fade. Wired to live data in M4 — imported here so the
// dependency and the contract are in place from M0.
import { coverageHeatmapLayer, trailLineLayer } from "@trailme/map-style";

// Default map center until a site/org viewport is resolved (Oslo).
const DEFAULT_CENTER = { longitude: 10.7522, latitude: 59.9139, zoom: 11 };

// Reference the placeholder style objects so the import is load-bearing and the
// contract surface stays visible. No layers are rendered until M4.
void coverageHeatmapLayer;
void trailLineLayer;

type MapShellProps = {
  orgId: string | null;
  role: Role | null;
  siteIds: string[];
  email?: string;
};

export function MapShell({ orgId, role, siteIds, email }: MapShellProps) {
  const [windowMinutes, setWindowMinutes] = useState<TimeWindow>(15);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      {mapboxToken ? (
        <Map
          mapboxAccessToken={mapboxToken}
          initialViewState={DEFAULT_CENTER}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <div
          style={{
            display: "grid",
            placeItems: "center",
            width: "100%",
            height: "100%",
            color: "var(--muted)",
            padding: "2rem",
            textAlign: "center",
          }}
        >
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
          gap: "1rem",
          padding: "0.625rem 0.875rem",
          background: "rgba(20, 25, 35, 0.85)",
          backdropFilter: "blur(8px)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          pointerEvents: "auto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong>TrailMe — Live</strong>
          <span style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
            {email ?? "—"}
            {role ? ` · ${role}` : ""}
            {siteIds.length ? ` · ${siteIds.length} site(s)` : ""}
          </span>
        </div>

        <TimeWindowSelector value={windowMinutes} onChange={setWindowMinutes} />
      </header>

      {/* orgId is plumbed through for the M3/M4 per-site Realtime subscriptions. */}
      <span hidden data-org-id={orgId ?? ""} />
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
    <div
      role="group"
      aria-label="Coverage time window (minutes)"
      style={{ display: "flex", gap: "0.25rem" }}
    >
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
