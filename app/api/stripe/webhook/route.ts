import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

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

        if (customerId && customerEmail) {
          // 1) Supabase Auth から user_id を取得
          const { data: userData, error: userErr } =
            await supabaseAdmin.auth.admin.getUserByEmail(customerEmail);

          if (userErr || !userData?.user?.id) {
            // ユーザーが未作成の場合はスキップ（user_id がキーのため無理に作らない）
            console.warn(
              "Webhook: user not found for email; skip linking",
              customerEmail
            );
            break;
          }

          const uid = userData.user.id;
          // 2) user_id をキーに upsert（email は冪等のため毎回更新）
          await supabaseAdmin
            .from("user_stripe")
            .upsert(
              {
                user_id: uid,
                email: customerEmail,
                stripe_customer_id: customerId,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "user_id" }
            );
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        const customerId: string = sub.customer;
        const status: string = sub.status; // active / canceled など

        // プラン種別の推定
        let planType: "lite" | "business" | null = null;
        try {
          const item = sub.items?.data?.[0];
          if (item?.price?.product) {
            const product = await stripe.products.retrieve(item.price.product);
            const name = (product.name || "").toLowerCase();
            if (name.includes("lite")) planType = "lite";
            if (name.includes("business")) planType = "business";
          }
        } catch (e) {
          console.warn("Failed to infer plan type from product", e);
        }

        await supabaseAdmin
          .from("user_stripe")
          .update({
            current_plan: status === "active" ? planType : null,
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_customer_id", customerId);
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
