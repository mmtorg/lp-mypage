import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, getUserIdByEmail } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

/**
 * ?user_id= または ?email= を受けて current_plan を返す最小API
 * 本番はサーバー側セッションから user_id を取得してください。
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const qpUserId = searchParams.get("user_id");
    const qpEmail = searchParams.get("email");

    // 1) セッション優先
    let effectiveUserId: string | null = user?.id ?? null;
    let resolvedEmail: string | null = user?.email ?? null;

    // 2) セッションが無い場合のみ、クエリにフォールバック
    if (!effectiveUserId) {
      if (qpUserId) effectiveUserId = qpUserId;
      if (!effectiveUserId && qpEmail) {
        // Try resolving user_id via Admin REST; fallback to email lookup in user_stripe
        const uid = await getUserIdByEmail(qpEmail).catch(() => null);
        if (uid) {
          effectiveUserId = uid;
          resolvedEmail = qpEmail;
        } else {
          // No user_id, try querying by email directly
          const { data } = await supabaseAdmin
            .from("user_stripe")
            .select("current_plan, email")
            .eq("email", qpEmail)
            .maybeSingle();
          return NextResponse.json({
            current_plan: data?.current_plan ?? null,
            email: data?.email ?? qpEmail,
          });
        }
      }
    }

    if (!effectiveUserId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { data, error } = await supabaseAdmin
      .from("user_stripe")
      .select("stripe_customer_id, current_plan, email")
      .eq("user_id", effectiveUserId)
      .single();

    if (error || !data?.stripe_customer_id) {
      return NextResponse.json({
        current_plan: null,
        email: resolvedEmail ?? qpEmail ?? null,
      });
    }

    return NextResponse.json({
      current_plan: data.current_plan ?? null,
      email: resolvedEmail ?? data.email ?? null,
    });
  } catch (error) {
    console.error("Subscription API error:", error);
    return NextResponse.json(
      { error: "サブスクリプション情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
