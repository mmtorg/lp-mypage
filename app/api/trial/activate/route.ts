import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs"; // Stripe SDK 利用のため Node 実行
export const dynamic = "force-dynamic"; // request.url 等を使用するため動的扱い

function appOrigin(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_ORIGIN || req.nextUrl.origin;
}

function envList(name: string): string[] {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function resolveOrCreateCustomer(email: string): Promise<string> {
  // 1) user_stripe から既知の customer を探す
  try {
    const { data } = await supabaseAdmin
      .from("user_stripe")
      .select("stripe_customer_id")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1);
    const known = (data || []).find((r: any) => r?.stripe_customer_id);
    if (known?.stripe_customer_id) return known.stripe_customer_id as string;
  } catch {}

  // 2) Stripe 検索（メール一致）
  try {
    const found = await stripe.customers.search({
      query: `email:'${email.replace(/'/g, " ")}'`,
      limit: 1,
    });
    const c = found.data?.[0];
    if (c?.id) return c.id;
  } catch {}

  // 3) 新規作成
  const c = await stripe.customers.create({ email });
  return c.id;
}

async function chooseRecurringPriceId(productId: string): Promise<string | null> {
  // productに紐づくアクティブな定期課金Priceのうち、まず月額を優先、なければ最初のもの
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 20 });
  const recurring = prices.data.filter((p: any) => p?.type === "recurring");
  if (!recurring.length) return null;
  const monthly = recurring.find((p: any) => (p?.recurring?.interval ?? "").toLowerCase() === "month");
  return (monthly ?? recurring[0])?.id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = (url.searchParams.get("token") || "").trim();
    if (!token) return NextResponse.json({ error: "token is required" }, { status: 400 });

    // トークン検証
    const { data, error } = await supabaseAdmin
      .from("trial_requests")
      .select("id, email, product_id, status, expires_at")
      .eq("token", token)
      .maybeSingle();
    if (error || !data?.id) {
      return NextResponse.redirect(new URL(`/mypage?trial=invalid`, appOrigin(req)), 302);
    }

    const now = Date.now();
    const expMs = new Date(String(data.expires_at)).getTime();
    if (now > expMs || data.status === "expired") {
      return NextResponse.redirect(new URL(`/mypage?trial=expired`, appOrigin(req)), 302);
    }
    if (data.status !== "requested") {
      // 多重クリック等は許容してマイページへ
      return NextResponse.redirect(new URL(`/mypage?trial=already`, appOrigin(req)), 302);
    }

    const email = String((data as any).email || "").trim();
    const productId = String((data as any).product_id || "").trim();

    // 許可されたトライアル商品限定（Webhook側のチェックと整合）
    const allowed = new Set(envList("STRIPE_TRIAL_PRODUCT_IDS"));
    if (allowed.size > 0 && !allowed.has(productId)) {
      return NextResponse.redirect(new URL(`/mypage?trial=product_denied`, appOrigin(req)), 302);
    }

    // 先にactivatedフラグ（冪等性担保）
    await supabaseAdmin
      .from("trial_requests")
      .update({ status: "activated", activated_at: new Date().toISOString() })
      .eq("id", data.id);

    // Stripe: 顧客の解決
    const customerId = await resolveOrCreateCustomer(email);

    // 該当商品の定期課金Priceを選択
    const priceId = await chooseRecurringPriceId(productId);
    if (!priceId) {
      console.error("[trial:activate] no recurring price for product", productId);
      return NextResponse.redirect(new URL(`/mypage?trial=price_missing`, appOrigin(req)), 302);
    }

    // 30日トライアル・カード未取得で開始（支払い方法は後で収集）
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId, quantity: 1 }],
      trial_period_days: Number(process.env.TRIAL_PERIOD_DAYS || 30),
      payment_behavior: "default_incomplete",
      // Webhookで product_id により trial と判定（STRIPE_TRIAL_PRODUCT_IDS と整合）
    });

    // trial_requests を消費済みに
    await supabaseAdmin
      .from("trial_requests")
      .update({ status: "consumed", consumed_at: new Date().toISOString(), stripe_customer_id: customerId, stripe_subscription_id: sub.id })
      .eq("id", data.id);

    // Webhookで user_stripe / recipient_emails が挿入・更新される（既存実装）
    const redirectUrl = new URL(`/mypage?trial=success&email=${encodeURIComponent(email)}`, appOrigin(req));
    return NextResponse.redirect(redirectUrl, 302);
  } catch (e) {
    console.error("/api/trial/activate error", e);
    return NextResponse.redirect(new URL(`/mypage?trial=error`, appOrigin(req)), 302);
  }
}
