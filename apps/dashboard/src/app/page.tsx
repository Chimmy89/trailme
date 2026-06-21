import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Root entry. Sends authenticated users to the live map, everyone else to login.
 * Middleware already gates `/`, but resolving here keeps the redirect explicit.
 */
export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/map" : "/login");
}
