import { createClient } from "@supabase/supabase-js";

// Prefer server-side env vars; fall back to NEXT_PUBLIC for compatibility
const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Soft warn only to avoid breaking local dev mocks
  console.warn(
    "Supabase admin client missing configuration. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set."
  );
}

export const supabaseAdmin = createClient(
  SUPABASE_URL ?? "",
  SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } }
);

// Helper: fetch user_id by email via GoTrue Admin REST API
export async function getUserIdByEmail(email: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const base = SUPABASE_URL.replace(/\/$/, "");
    const url = `${base}/auth/v1/admin/users?email=${encodeURIComponent(email)}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    // Accept several possible shapes
    const candidates = Array.isArray(json)
      ? json
      : Array.isArray((json as any).users)
      ? (json as any).users
      : (json as any).user
      ? [(json as any).user]
      : [];
    const found = candidates.find(
      (u: any) => typeof u?.email === "string" && u.email.toLowerCase() === email.toLowerCase()
    );
    return found?.id ?? null;
  } catch (e) {
    console.warn("getUserIdByEmail failed:", e);
    return null;
  }
}
