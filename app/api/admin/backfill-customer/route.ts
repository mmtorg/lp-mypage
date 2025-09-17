import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin, getUserIdByEmail } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const adminToken = req.headers.get("x-admin-token");
    const expected = process.env.ADMIN_API_TOKEN || "";
    if (!expected || adminToken !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim();
    let userId: string | null = body?.user_id || null;
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

    if (!userId) {
      userId = await getUserIdByEmail(email);
      if (!userId) return NextResponse.json({ error: "user not found" }, { status: 404 });
    }

    // Find Stripe customer by email
    const found = await stripe.customers.search({
      query: `email:'${email.replace(/'/g, " ")}'`,
      limit: 1,
    });
    const customer = found.data?.[0];
    if (!customer?.id) {
      return NextResponse.json({ error: "stripe customer not found" }, { status: 404 });
    }

    await supabaseAdmin
      .from("user_stripe")
      .upsert(
        {
          user_id: userId,
          email,
          stripe_customer_id: customer.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    return NextResponse.json({ ok: true, user_id: userId, stripe_customer_id: customer.id, email });
  } catch (e) {
    console.error("backfill-customer error", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}

