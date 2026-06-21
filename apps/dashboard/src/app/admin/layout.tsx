import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const NAV = [
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/roster", label: "Roster" },
  { href: "/admin/audit", label: "Audit" },
] as const;

/**
 * Auth gate + chrome for the admin section. Middleware already blocks
 * unauthenticated traffic; this re-checks at the server boundary so a missing
 * session never renders admin tooling. Role-based authorization (org_admin /
 * supervisor) is enforced by RLS and tightened here in M5.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex" }}>
      <nav
        style={{
          width: "14rem",
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          padding: "1.5rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        <Link href="/map" style={{ fontWeight: 600, marginBottom: "1rem" }}>
          TrailMe
        </Link>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: "0.375rem 0.5rem",
              borderRadius: "6px",
              color: "var(--foreground)",
            }}
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/map"
          style={{ marginTop: "auto", color: "var(--muted)" }}
        >
          ← Back to map
        </Link>
      </nav>

      <main style={{ flex: 1, padding: "2rem", maxWidth: "60rem" }}>
        {children}
      </main>
    </div>
  );
}
