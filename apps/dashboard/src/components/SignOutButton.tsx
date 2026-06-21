"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Signs out via the browser client and returns to /login. */
export function SignOutButton({ style }: { style?: React.CSSProperties }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
      style={{
        padding: "0.25rem 0.625rem",
        background: "var(--surface-2)",
        color: "var(--foreground)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        cursor: "pointer",
        ...style,
      }}
    >
      Sign out
    </button>
  );
}
