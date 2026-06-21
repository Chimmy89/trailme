"use client";

import { useEffect, useState } from "react";
import Map from "react-map-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { TIME_WINDOWS, type Role, type TimeWindow } from "@trailme/shared";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";

// Default map center until live positions resolve a viewport (Oslo).
const DEFAULT_CENTER = { longitude: 10.7522, latitude: 59.9139, zoom: 11 };

type MapShellProps = {
  orgId: string | null;
  orgName: string | null;
  role: Role | null;
  siteIds: string[];
  email?: string;
};

type Presence = { online: number; tracked: number };

export function MapShell({ orgId, orgName, role, siteIds, email }: MapShellProps) {
  const [windowMinutes, setWindowMinutes] = useState<TimeWindow>(15);
  const [presence, setPresence] = useState<Presence>({ online: 0, tracked: 0 });

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Poll last-known positions. Postgres Realtime / the consolidated per-site
  // broadcast (M3) replaces this; polling is enough for the first live surface.
  useEffect(() => {
    if (!orgId) return;
    const supabase = createClient();
    let active = true;

    async function load() {
      const { data } = await supabase.from("guard_positions").select("guard_id, online");
      if (!active || !data) return;
      setPresence({
        online: data.filter((row) => row.online).length,
        tracked: data.length,
      });
    }

    void load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [orgId]);

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
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <strong>{orgName ?? "TrailMe"} — Live</strong>
          <span style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>
            {email ?? "—"}
            {role ? ` · ${role}` : ""}
            {siteIds.length ? ` · ${siteIds.length} site(s)` : ""}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <TimeWindowSelector value={windowMinutes} onChange={setWindowMinutes} />
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
          color: presence.tracked ? "var(--foreground)" : "var(--muted)",
          fontSize: "0.8125rem",
          maxWidth: "26rem",
        }}
      >
        {presence.tracked ? (
          <span>
            <strong style={{ color: "var(--accent)" }}>{presence.online}</strong> online ·{" "}
            {presence.tracked} tracked · last {windowMinutes}m
          </span>
        ) : (
          <span>
            No guards online yet — start the field app and clock in to see live positions and
            trails here.
          </span>
        )}
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
