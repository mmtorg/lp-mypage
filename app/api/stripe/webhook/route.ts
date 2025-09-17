import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin, getUserIdByEmail } from "@/lib/supabase-admin";

export const runtime = "nodejs"; // Edge不可（署名検証にraw body必要）

export async function POST(req: NextRequest) {
  const sig = req.headers.get("stripe-signature") as string | null;
  const raw = await req.text();

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(
      raw,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return new NextResponse(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const customerId: string | null = session.customer ?? null;
        const customerEmail: string | null =
          session.customer_details?.email ?? session.customer_email ?? null;
        console.log("[webhook] checkout.session.completed", { customerId, customerEmail });

        if (customerId && customerEmail) {
          // 1) Supabase Auth から user_id を取得。無ければ自動作成（事前登録なし運用）
          let uid = await getUserIdByEmail(customerEmail);
          if (!uid) {
            try {
              const created = await (supabaseAdmin as any).auth.admin.createUser({
                email: customerEmail,
                email_confirm: true,
              });
              uid = created?.data?.user?.id ?? null;
            } catch (e) {
              console.error("Auto-create user failed:", e);
            }
          }
          if (!uid) break;
          // 2) user_id をキーに upsert（email は冪等のため毎回更新）
          await supabaseAdmin.from("user_stripe").upsert(
            {
              user_id: uid,
              email: customerEmail,
              stripe_customer_id: customerId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );

          // 3) ニュース配信先に本人メールを必ず含める（ユニーク制約により冪等）
          await supabaseAdmin
            .from("recipient_emails")
            .upsert(
              [{ user_id: uid, email: customerEmail, plan: null }],
              { onConflict: "email", ignoreDuplicates: true }
            );
          console.log("[webhook] linked user", { uid, customerId });
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        const customerId: string = sub.customer;
        const status: string = sub.status; // active / trialing / canceled など
        const VALID_STATUSES = new Set(
          (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing")
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
        );

        // プラン種別の推定（Product ID のみ）
        const LITE_PRODUCT_IDS = (process.env.STRIPE_PRODUCT_IDS_LITE || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const BUSINESS_PRODUCT_IDS = (process.env.STRIPE_PRODUCT_IDS_BUSINESS || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        let planType: "lite" | "business" | null = null;
        try {
          const item = sub.items?.data?.[0];
          console.log("[webhook] subscription item", {
            priceId: item?.price?.id,
            product: typeof item?.price?.product === "string" ? item?.price?.product : item?.price?.product?.id,
            status,
          });
          // 1) Product ID で判定（優先）
          const prodAny = item?.price?.product as any;
          const productId: string | undefined = typeof prodAny === "string" ? prodAny : prodAny?.id;
          if (productId) {
            if (LITE_PRODUCT_IDS.includes(productId)) planType = "lite";
            if (BUSINESS_PRODUCT_IDS.includes(productId)) planType = "business";
          }
          // 2) 最終フォールバック: Product名
          if (!planType && productId) {
            const product = await stripe.products.retrieve(productId);
            const name = (product.name || "").toLowerCase();
            if (name.includes("lite")) planType = "lite";
            if (name.includes("business")) planType = "business";
          }
        } catch (e) {
          console.warn("Failed to infer plan type", e);
        }

        await supabaseAdmin
          .from("user_stripe")
          .update({
            current_plan: VALID_STATUSES.has(String(status).toLowerCase()) ? planType : null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);
        console.log("[webhook] updated plan", { customerId, status, planType });
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("Webhook handler error:", err);
    return new NextResponse("Server error", { status: 500 });
  }
}
