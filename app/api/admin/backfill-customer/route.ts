import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const adminToken = req.headers.get("x-admin-token");
    const expected = process.env.ADMIN_API_TOKEN || "";
    if (!expected || adminToken !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim();
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

    // Find Stripe customer by email
    const found = await stripe.customers.search({
      query: `email:'${email.replace(/'/g, " ")}'`,
      limit: 1,
    });
    const customer = found.data?.[0];
    if (!customer?.id) {
      return NextResponse.json({ error: "stripe customer not found" }, { status: 404 });
    }

    // Update by customer_id if exists, otherwise insert new row
    const { data: existing } = await supabaseAdmin
      .from("user_stripe")
      .select("id")
      .eq("stripe_customer_id", customer.id)
      .maybeSingle();

    if (existing?.id) {
      await supabaseAdmin
        .from("user_stripe")
        .update({ email, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin
        .from("user_stripe")
        .insert({ email, stripe_customer_id: customer.id, updated_at: new Date().toISOString() });
    }

    return NextResponse.json({ ok: true, stripe_customer_id: customer.id, email });
  } catch (e) {
    console.error("backfill-customer error", e);
    return NextResponse.json({ error: "server error" }, { status: 500 });
  }
}
