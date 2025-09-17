import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";

type Plan = "lite" | "business";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      plan: Plan;
      quantity: number;
      ownerEmail?: string;
    };

    const plan = body?.plan;
    // Normalize quantity to a safe integer within bounds
    const quantity = Math.min(10, Math.max(1, Math.floor(Number(body?.quantity))));
    const ownerEmail = (body?.ownerEmail || "").trim() || undefined;

    if (plan !== "lite" && plan !== "business") {
      return NextResponse.json({ error: "invalid plan" }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 10) {
      return NextResponse.json({ error: "invalid quantity" }, { status: 400 });
    }

    const priceId =
      (plan === "lite" && process.env.STRIPE_ADDON_PRICE_ID_LITE) ||
      (plan === "business" && process.env.STRIPE_ADDON_PRICE_ID_BUSINESS) ||
      undefined;
    if (!priceId) {
      return NextResponse.json({ error: "missing price id" }, { status: 500 });
    }

    // Determine session mode based on price type
    const price = await stripe.prices.retrieve(priceId);
    const mode: "payment" | "subscription" =
      (price as any)?.type === "recurring" ? "subscription" : "payment";

    const origin = req.nextUrl.origin;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || origin;
    const success_url = `${baseUrl}/mypage?success=1`;
    const cancel_url = `${baseUrl}/mypage?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [
        {
          price: priceId,
          quantity,
          // Explicitly show and allow adjusting quantity on Checkout
          adjustable_quantity: { enabled: true, minimum: 1, maximum: 10 },
        },
      ],
      success_url,
      cancel_url,
      customer_email: ownerEmail,
      // payment_intent_data / subscription_data can be extended later if needed
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("/api/stripe/checkout error:", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
