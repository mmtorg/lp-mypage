import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";

type Plan = "lite" | "business" | null;

const ACTIVE_STATUSES = new Set(
  (process.env.SUBSCRIPTION_VALID_STATUSES || "active,trialing,past_due,unpaid")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function envList(name: string): string[] {
  return String(process.env[name] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Collect all addon price ids we consider as seat add-ons
const ADDON_PRICE_IDS = new Set(
  [
    process.env.STRIPE_ADDON_PRICE_ID_LITE_MONTHLY,
    process.env.STRIPE_ADDON_PRICE_ID_LITE_YEARLY,
    process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_MONTHLY,
    process.env.STRIPE_ADDON_PRICE_ID_BUSINESS_YEARLY,
    ...envList("STRIPE_ADDON_PRICE_IDS"),
  ].filter((v): v is string => typeof v === "string" && !!v)
);

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const email = (searchParams.get("email") || "").trim();
    if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });

    // Resolve plan and stripe_customer_id, collect parent ids
    const { data: usRows, error: usErr } = await supabaseAdmin
      .from("user_stripe")
      .select("id, current_plan, stripe_customer_id")
      .eq("email", email);
    if (usErr) {
      console.warn("[limits] user_stripe query error", usErr);
    }

    const parentIds: number[] = (usRows ?? []).map((r: any) => r.id).filter((v: any) => typeof v === "number");
    const stripeCustomerId: string | undefined = (usRows ?? []).find((r: any) => r?.stripe_customer_id)?.stripe_customer_id || undefined;
    const plan: Plan = ((usRows ?? []).find((r: any) => r?.current_plan)?.current_plan as Plan) ?? null;

    // Base slots from plan_limits; fallback defaults (lite=1, business=4)
    let baseSlots = 0;
    if (plan) {
      try {
        const { data: lim } = await supabaseAdmin
          .from("plan_limits")
          .select("base_recipient_slots")
          .eq("plan", plan)
          .maybeSingle();
        if (lim?.base_recipient_slots != null) {
          baseSlots = Number(lim.base_recipient_slots) || 0;
        } else {
          baseSlots = plan === "business" ? 4 : 1;
        }
      } catch {
        baseSlots = plan === "business" ? 4 : 1;
      }
    }

    // Addon slots: sum of quantities of addon price ids on active subs
    let addonSlots = 0;
    if (stripeCustomerId && ADDON_PRICE_IDS.size > 0) {
      try {
        const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 50, expand: ["data.items.data.price"] });
        for (const s of subs.data) {
          const status = String((s as any)?.status || "").toLowerCase();
          if (!ACTIVE_STATUSES.has(status)) continue;
          const items: any[] = Array.isArray((s as any)?.items?.data) ? (s as any).items.data : [];
          for (const it of items) {
            const priceId: string | undefined = typeof it?.price === "string" ? (it?.price as any) : (it?.price?.id as string | undefined);
            if (priceId && ADDON_PRICE_IDS.has(priceId)) {
              addonSlots += Number(it?.quantity || 0);
            }
          }
        }
      } catch (e) {
        console.warn("[limits] stripe subscriptions list failed", e);
      }
    }

    // Used slots = number of recipients for the parent subscriptions (exclude pending_removal)
    let usedSlots = 0;
    if (parentIds.length > 0) {
      try {
        const { data: recs } = await supabaseAdmin
          .from("recipient_emails")
          .select("id, pending_removal")
          .in("user_stripe_id", parentIds);
        usedSlots = (recs ?? []).filter((r: any) => !r?.pending_removal).length;
      } catch {}
    }

    const total = baseSlots + addonSlots;
    const remaining = Math.max(0, total - usedSlots);

    return NextResponse.json({
      plan,
      base_slots: baseSlots,
      addon_slots: addonSlots,
      used_slots: usedSlots,
      remaining_slots: remaining,
    });
  } catch (e) {
    console.error("/api/me/limits error", e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

