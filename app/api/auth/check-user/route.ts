import { NextRequest, NextResponse } from "next/server";
import { getUserIdByEmail } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = (searchParams.get("email") || "").trim();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    // Simple email check
    if (!/.+@.+\..+/.test(email)) {
      return NextResponse.json({ error: "invalid email" }, { status: 400 });
    }

    const userId = await getUserIdByEmail(email);
    return NextResponse.json({ exists: Boolean(userId) });
  } catch (e) {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

