import { type NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin, getUserIdByEmail } from "@/lib/supabase-admin";
import { getSupabaseServer } from "@/lib/supabase-server";

/**
 * セッションの user_id を最優先で使用し、互換として ?user_id= / ?email= も許容
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const qpUserId = searchParams.get("user_id");
    const qpEmail = searchParams.get("email");

    // 既存互換: JSON body から return_url, email を受け取り可能
    let returnUrl: string | undefined;
    let emailFromBody: string | undefined;
    try {
      const body = await request.json();
      returnUrl = body?.return_url as string | undefined;
      emailFromBody = body?.email as string | undefined;
    } catch {}

    const email = qpEmail || emailFromBody || undefined;

    // 1) セッション優先
    let effectiveUserId: string | null = user?.id ?? null;

    // 2) セッションが無い場合のみ、クエリフォールバック
    if (!effectiveUserId) {
      if (qpUserId) effectiveUserId = qpUserId;
      if (!effectiveUserId && email) {
        const uid = await getUserIdByEmail(email);
        if (uid) effectiveUserId = uid;
      }
    }

    // セッションもフォールバックも無い場合はデモ互換モックURL
    if (!effectiveUserId) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const mockPortalUrl =
        "https://billing.stripe.com/p/session/test_mock_session_id";
      return NextResponse.json({ url: mockPortalUrl });
    }

    // 顧客ID取得（user_id キー）
    let stripeCustomerId: string | undefined;
    let knownEmail: string | undefined;
    if (effectiveUserId) {
      const { data: byUser, error: byUserErr } = await supabaseAdmin
        .from("user_stripe")
        .select("stripe_customer_id, email")
        .eq("user_id", effectiveUserId)
        .maybeSingle();
      if (byUserErr) console.warn("/portal: user_stripe by user_id error", byUserErr);
      stripeCustomerId = byUser?.stripe_customer_id ?? undefined;
      knownEmail = byUser?.email ?? undefined;
    }

    // フォールバック: email で user_stripe を検索
    if (!stripeCustomerId && email) {
      const { data: byEmail, error: byEmailErr } = await supabaseAdmin
        .from("user_stripe")
        .select("stripe_customer_id, email, user_id")
        .eq("email", email)
        .maybeSingle();
      if (byEmailErr) console.warn("/portal: user_stripe by email error", byEmailErr);
      stripeCustomerId = byEmail?.stripe_customer_id ?? stripeCustomerId;
      knownEmail = byEmail?.email ?? knownEmail;
      // ユーザーIDが確定しており、customerが取得できた場合はリンクを補完
      if (!effectiveUserId && byEmail?.user_id) {
        effectiveUserId = byEmail.user_id;
      }
    }

    // さらにフォールバック: Stripe上で顧客検索（メール必須）
    if (!stripeCustomerId && (email || knownEmail)) {
      try {
        const targetEmail = email || knownEmail!;
        const found = await stripe.customers.search({
          query: `email:'${targetEmail.replace(/'/g, " ")}'`,
          limit: 1,
        });
        const c = found.data?.[0];
        if (c?.id) {
          stripeCustomerId = c.id;
          // user_id があり、まだリンクされていなければ保存（冪等）
          if (effectiveUserId) {
            await supabaseAdmin
              .from("user_stripe")
              .upsert(
                {
                  user_id: effectiveUserId,
                  email: targetEmail,
                  stripe_customer_id: stripeCustomerId,
                  updated_at: new Date().toISOString(),
                },
                { onConflict: "user_id" }
              );
          }
        }
      } catch (e) {
        console.warn("/portal: stripe customer search failed", e);
      }
    }

    if (!stripeCustomerId) {
      return new NextResponse("Stripe customer not found", { status: 404 });
    }

    const defaultReturn = `${
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "https://your-app.example"
    }/mypage`;
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
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
