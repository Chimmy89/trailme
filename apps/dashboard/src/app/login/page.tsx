import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/map");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "1.5rem",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "22rem",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "2rem",
        }}
      >
        <h1 style={{ margin: "0 0 0.25rem", fontSize: "1.25rem" }}>TrailMe</h1>
        <p style={{ margin: "0 0 1.5rem", color: "var(--muted)" }}>
          Sign in to the control room.
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
