import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase-server";
export const dynamic = "force-dynamic"; // request.url を利用

export async function GET(request: NextRequest) {
  const supabase = getSupabaseServer();
  await supabase.auth.signOut();
  const url = new URL(request.url);
  url.pathname = "/mypage";
  return NextResponse.redirect(url);
}
