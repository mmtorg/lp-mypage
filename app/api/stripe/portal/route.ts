import { type NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * セッションの user_id を最優先で使用し、互換として ?user_id= / ?email= も許容
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
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

    // 顧客ID取得（email ベース）
    let stripeCustomerId: string | undefined;
    let knownEmail: string | undefined = email;
    if (email) {
      const { data: byEmail, error: byEmailErr } = await supabaseAdmin
        .from("user_stripe")
        .select("stripe_customer_id, email, updated_at")
        .eq("email", email)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byEmailErr) console.warn("/portal: user_stripe by email error", byEmailErr);
      stripeCustomerId = byEmail?.stripe_customer_id ?? undefined;
      knownEmail = byEmail?.email ?? knownEmail;
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
          // 補完保存（冪等）
          // DB側に customer 一意制約が無い想定のため、明示的に select→update/insert で対応
          try {
            const { data: existing } = await supabaseAdmin
              .from("user_stripe")
              .select("id")
              .eq("stripe_customer_id", stripeCustomerId)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (existing?.id) {
              await supabaseAdmin
                .from("user_stripe")
                .update({ email: targetEmail, updated_at: new Date().toISOString() })
                .eq("id", existing.id);
            } else {
              await supabaseAdmin
                .from("user_stripe")
                .insert({ email: targetEmail, stripe_customer_id: stripeCustomerId, updated_at: new Date().toISOString() });
            }
          } catch {}
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
