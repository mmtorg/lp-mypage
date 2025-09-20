import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

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

    // 同一メールで複数サブスクリプションがあり得るため、更新日時が新しいものを優先
    const { data, error } = await supabaseAdmin
      .from("user_stripe")
      .select("current_plan, email")
      .eq("email", effectiveEmail)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("/api/me/subscription query error", error);
    }

    return NextResponse.json({
      current_plan: (data?.current_plan as "lite" | "business" | null) ?? null,
      email: data?.email ?? effectiveEmail,
    });
  } catch (error) {
    console.error("Subscription API error:", error);
    return NextResponse.json(
      { error: "サブスクリプション情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
