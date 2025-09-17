import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";

export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession();
  const url = new URL(request.url);
  if (error) {
    url.pathname = "/login";
    url.searchParams.set("error", "auth");
    return NextResponse.redirect(url);
  }
  url.pathname = "/mypage";
  url.searchParams.delete("error");
  return NextResponse.redirect(url);
}

