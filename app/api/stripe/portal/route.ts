import { type NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * 前提：アプリ側でユーザーの user_id を特定できる（Auth セッション）
 * 互換性のため、クエリ ?user_id= または ?email= を許容。
 * 本番はサーバー側でセッションから user_id を取得してください。
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const emailParam = searchParams.get("email");

    // 既存のクライアント実装互換: JSON body から return_url を受け取る
    let returnUrl: string | undefined;
    let emailFromBody: string | undefined;
    try {
      const body = await request.json();
      returnUrl = body?.return_url as string | undefined;
      emailFromBody = body?.email as string | undefined;
    } catch {}

    const email = emailParam || emailFromBody || undefined;

    // ID特定がない場合は、従来のモックURLを返す（デモ互換）
    if (!userId && !email) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockPortalUrl =
        "https://billing.stripe.com/p/session/test_mock_session_id";
      return NextResponse.json({ url: mockPortalUrl });
    }

    // Supabase から顧客IDを取得
    let row: { stripe_customer_id: string; email: string } | null = null;
    if (userId) {
      const { data, error } = await supabaseAdmin
        .from("user_stripe")
        .select("stripe_customer_id, email")
        .eq("user_id", userId)
        .single();
      if (error) throw error;
      row = data;
    } else if (email) {
      // メールから user_id を解決し、user_id をキーに取得
      const { data: userData, error: userErr } =
        await supabaseAdmin.auth.admin.getUserByEmail(email);
      if (userErr || !userData?.user?.id) {
        return new NextResponse("User not found for email", { status: 404 });
      }
      const resolvedUserId = userData.user.id;
      const { data, error } = await supabaseAdmin
        .from("user_stripe")
        .select("stripe_customer_id, email")
        .eq("user_id", resolvedUserId)
        .single();
      if (error) throw error;
      row = data;
    }

    if (!row?.stripe_customer_id) {
      return new NextResponse("Stripe customer not found", { status: 404 });
    }

    const defaultReturn = `${
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "https://your-app.example"
    }/mypage`;
    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: returnUrl || defaultReturn,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Stripe portal API error:", error);
    return NextResponse.json(
      {
        error: "ポータルURLの生成に失敗しました",
        message: error instanceof Error ? error.message : "不明なエラー",
      },
      { status: 500 }
    );
  }
}
