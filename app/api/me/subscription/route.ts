import { type NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

/**
 * ?user_id= または ?email= を受けて current_plan を返す最小API
 * 本番はサーバー側セッションから user_id を取得してください。
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const email = searchParams.get("email");

    if (!userId && !email) {
      return new NextResponse("user_id or email is required", { status: 400 });
    }

    // まず email -> user_id を解決（メール優先の仕様）
    let effectiveUserId = userId as string | null;
    let resolvedEmail = email as string | null;
    if (!effectiveUserId && email) {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserByEmail(
          email
        );
        if (error || !data?.user) {
          return NextResponse.json({ current_plan: null, email });
        }
        effectiveUserId = data.user.id;
        resolvedEmail = data.user.email ?? email;
      } catch {
        return NextResponse.json({ current_plan: null, email });
      }
    }

    // DB から stripe_customer_id, current_plan を user_id で取得
    let row:
      | {
          stripe_customer_id: string | null;
          current_plan: any;
          email: string | null;
        }
      | null = null;
    if (effectiveUserId) {
      const { data, error } = await supabaseAdmin
        .from("user_stripe")
        .select("stripe_customer_id, current_plan, email")
        .eq("user_id", effectiveUserId)
        .single();
      if (error) {
        // user_stripe に未作成の場合も null 返却
        return NextResponse.json({ current_plan: null, email: resolvedEmail });
      }
      row = data;
    }

    if (!row?.stripe_customer_id) {
      return NextResponse.json({ current_plan: null, email: resolvedEmail });
    }

    return NextResponse.json({
      current_plan: row.current_plan ?? null,
      email: resolvedEmail ?? row.email ?? null,
    });
  } catch (error) {
    console.error("Subscription API error:", error);
    return NextResponse.json(
      { error: "サブスクリプション情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
