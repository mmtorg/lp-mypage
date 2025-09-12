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

