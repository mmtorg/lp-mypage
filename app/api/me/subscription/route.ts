import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

export const dynamic = 'force-dynamic';

/**
 * ?email= を受けて current_plan を返す最小API
 * Supabase Auth を使わない前提に合わせ、user_id 依存を排除。
 * セッションに email があればフォールバックとして利用します。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const qpEmail = (searchParams.get("email") || "").trim();

    let effectiveEmail: string | null = qpEmail || null;
    if (!effectiveEmail) {
      // 互換: サーバー側セッションの email を参照（存在する場合のみ）
      try {
        const supabase = getSupabaseServer();
        const { data } = await supabase.auth.getUser();
        effectiveEmail = data.user?.email ?? null;
      } catch {}
    }

    if (!effectiveEmail) {
      return NextResponse.json({ error: "email is required" }, { status: 400 });
    }

    // 同一メールで trial と lite/business が併存する可能性があるため、lite/business を優先
    const { data: rows, error } = await supabaseAdmin
      .from("user_stripe")
      .select("current_plan, email, updated_at")
      .eq("email", effectiveEmail);

    if (error) {
      console.warn("/api/me/subscription query error", error);
    }

    const items = (rows ?? []) as Array<{ current_plan: "lite" | "business" | "trial" | null; email: string | null; updated_at?: string }>;
    const rank = (p: string | null | undefined) => (p === "business" ? 3 : p === "lite" ? 2 : p === "trial" ? 1 : 0);
    const prioritized = items
      .slice()
      .sort((a, b) => {
        const r = rank(b.current_plan) - rank(a.current_plan);
        if (r !== 0) return r;
        const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return tb - ta;
      })[0];

    return NextResponse.json({
      current_plan: (prioritized?.current_plan as any) ?? null,
      email: prioritized?.email ?? effectiveEmail,
    });
  } catch (error) {
    console.error("Subscription API error:", error);
    return NextResponse.json(
      { error: "サブスクリプション情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
