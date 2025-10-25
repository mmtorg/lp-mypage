"use client";

import { createBrowserClient } from "@supabase/ssr";

export function getSupabaseBrowser() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
  // token_hash ベースのリンクを生成させるため PKCE ではなく implicit を使用
  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: { flowType: "implicit" },
  });
}
